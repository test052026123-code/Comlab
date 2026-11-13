import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk/core/contracts.dart';
import 'package:kiosk/core/lab_state.dart';
import 'package:kiosk/data/services.dart';
import 'package:kiosk/ui/app.dart';
import 'widget_test.dart' show MemoryStore;

class AvailabilityRepository implements LabRepository {
  int reads = 0;
  bool available = false;
  Completer<Json>? response;
  final posts = <String>[];
  Json get snapshot => {
    'controllerError': null,
    'workstations': [
      {
        'id': 'PC-01',
        'nodeId': 'NODE-01',
        'enabled': true,
        'maintenance': false,
        'sessionId': null,
        'eligible': available,
        'node': {
          'connectivity': available ? 'connected' : 'stale',
          'power': available ? 'off' : 'unknown',
        },
      },
    ],
  };
  @override
  Future<Json> get(String path) async {
    expect(path, '/workstations');
    reads++;
    return response == null ? snapshot : await response!.future;
  }

  @override
  Future<Json> post(String path, Json data) async {
    posts.add(path);
    return {};
  }

  @override
  Future<Json> put(String path, Json data) async => {};
  @override
  Future<String> exportCsv(String query) async => '';
}

void main() {
  Future<LabState> selection(
    WidgetTester tester,
    AvailabilityRepository repo,
  ) async {
    tester.view.physicalSize = const Size(1280, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final state = LabState(store: MemoryStore(), repositoryOverride: repo)
      ..ready = true
      ..student = {'id': 'S1', 'name': 'Mark Brian'}
      ..welcomeSeconds = 10;
    await state.showMap();
    await tester.pumpWidget(ComLabApp(state: state));
    return state;
  }

  testWidgets('an unavailable PC becomes selectable without manual refresh', (
    tester,
  ) async {
    final repo = AvailabilityRepository();
    final state = await selection(tester, repo);
    expect(find.text('0 available'), findsOneWidget);
    repo.available = true;
    await tester.pump(const Duration(seconds: 5));
    await tester.pump();
    expect(find.text('1 available'), findsOneWidget);
    await tester.tap(find.text('PC-01'));
    await tester.pump();
    expect(find.text('PC-01 is your selection'), findsOneWidget);
    expect(repo.posts, isEmpty);
    final reads = repo.reads;
    state.resetStudent();
    await tester.pump();
    await tester.pump(const Duration(seconds: 10));
    expect(repo.reads, reads);
    await tester.pumpWidget(const SizedBox.shrink());
    state.dispose();
  });

  testWidgets(
    'selection timeout follows touch activity, not background refreshes',
    (tester) async {
      final repo = AvailabilityRepository()..available = true;
      final state = await selection(tester, repo);
      await tester.pump(const Duration(seconds: 40));
      expect(
        state.screen,
        'map',
      ); // More time than the configured 10-second summary timeout.
      await tester.tap(find.text('PC-01'));
      await tester.pump(const Duration(seconds: 40));
      expect(
        state.screen,
        'map',
      ); // Original selection deadline has passed, but user touched it.
      await tester.pump(const Duration(seconds: 21));
      expect(
        state.screen,
        'welcome',
      ); // Read-only polling must not keep personal data open forever.
      expect(state.student, isNull);
      expect(repo.posts, isEmpty);
      await tester.pumpWidget(const SizedBox.shrink());
      state.dispose();
    },
  );

  testWidgets('manual and background reads share a request and fail closed', (
    tester,
  ) async {
    final repo = AvailabilityRepository()..available = true;
    final state = await selection(tester, repo);
    final reply = Completer<Json>();
    repo.response = reply;
    await tester.pump(const Duration(seconds: 5));
    final manual = expectLater(state.refreshPcs(), throwsA(isA<ApiFailure>()));
    expect(repo.reads, 2); // Initial snapshot + a single shared in-flight read.
    expect(
      state.cloudFresh,
      isTrue,
    ); // Healthy snapshot stays interactive during refresh.
    reply.completeError(ApiFailure('Connection failed.', null, true));
    await tester.pump();
    await manual;
    expect(state.cloudFresh, isFalse);
    expect(state.student?['id'], 'S1');
    repo.response = null;
    await tester.pump(const Duration(seconds: 5));
    expect(state.cloudFresh, isTrue);
    expect(state.screen, 'map');
    await tester.pumpWidget(const SizedBox.shrink());
    state.dispose();
  });

  testWidgets(
    'an in-flight status response is safe after leaving and disposal',
    (tester) async {
      final repo = AvailabilityRepository();
      final state = await selection(tester, repo);
      final reply = Completer<Json>();
      repo.response = reply;
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpWidget(const SizedBox.shrink());
      state.dispose();
      reply.complete(repo.snapshot);
      await tester.pump();
      expect(tester.takeException(), isNull);
    },
  );
}
