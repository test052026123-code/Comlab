import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk/core/contracts.dart';
import 'package:kiosk/data/services.dart';
import 'package:kiosk/ui/relay_test.dart';

class BenchRepository implements LabRepository {
  final posts = <Json>[];
  int gets = 0;
  bool failPost = false;
  String state = 'pending';
  Completer<Json>? response;
  @override
  Future<Json> post(String path, Json data) async {
    expect(path, '/admin/relay-tests');
    posts.add(Map<String, dynamic>.from(data));
    if (failPost) throw ApiFailure('Request timed out');
    return response == null ? {'state': state} : await response!.future;
  }

  @override
  Future<Json> get(String path) async {
    gets++;
    return {'state': state};
  }

  @override
  Future<Json> put(String path, Json data) async => {};
  @override
  Future<String> exportCsv(String query) async => '';
}

Widget dialog(BenchRepository repository) => MaterialApp(
  home: Scaffold(
    body: RelayTestDialog(
      repository: repository,
      pc: const {'id': 'PC-01', 'nodeId': 'NODE-01'},
    ),
  ),
);

void main() {
  testWidgets(
    'relay test sends once, polls with GET, and reports node completion',
    (tester) async {
      final repo = BenchRepository();
      await tester.pumpWidget(dialog(repo));
      expect(repo.posts, isEmpty);
      await tester.tap(find.text('Test relay (300 ms)'));
      await tester.pump();
      expect(repo.posts.length, 1);
      expect(repo.posts.single['workstationId'], 'PC-01');
      expect(find.textContaining('Waiting for central'), findsOneWidget);
      repo.state = 'pulse_finished';
      await tester.pump(const Duration(seconds: 2));
      expect(repo.gets, 1);
      expect(repo.posts.length, 1);
      expect(
        find.textContaining('Node reported: pulse finished'),
        findsOneWidget,
      );
      await tester.tap(find.text('Test relay (300 ms)'));
      await tester.pump();
      expect(repo.posts.length, 2);
      expect(repo.posts[0]['commandId'], isNot(repo.posts[1]['commandId']));
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('uncertain POST retry preserves the original test UUID', (
    tester,
  ) async {
    final repo = BenchRepository()..failPost = true;
    await tester.pumpWidget(dialog(repo));
    await tester.tap(find.text('Test relay (300 ms)'));
    await tester.pump();
    expect(find.text('Retry same request'), findsOneWidget);
    await tester.tap(find.text('Retry same request'));
    await tester.pump();
    expect(repo.posts.length, 2);
    expect(repo.posts.first, repo.posts.last);
    expect(repo.gets, 0);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
    'repeated taps and closing an outstanding request do not submit twice',
    (tester) async {
      final repo = BenchRepository()..response = Completer<Json>();
      await tester.pumpWidget(dialog(repo));
      final button = find.byType(FilledButton);
      await tester.tap(button);
      await tester.pump();
      await tester.tap(button);
      expect(repo.posts.length, 1);
      await tester.pumpWidget(const SizedBox());
      repo.response!.complete({'state': 'pending'});
      await tester.pump();
      expect(tester.takeException(), isNull);
      expect(repo.posts.length, 1);
    },
  );
}
