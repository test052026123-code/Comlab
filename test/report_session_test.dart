import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk/core/contracts.dart';
import 'package:kiosk/core/lab_state.dart';
import 'package:kiosk/data/services.dart';
import 'package:kiosk/ui/app.dart';
import 'widget_test.dart' show MemoryStore;

class ReportRepository implements LabRepository {
  Completer<Json>? response;
  Json reply = {'id': 'op1', 'sessionClosed': true};
  final posts = <Json>[];
  @override
  Future<Json> post(String path, Json data) async {
    expect(path, '/issues');
    posts.add(Map<String, dynamic>.from(data));
    return response?.future ?? reply;
  }

  @override
  Future<Json> get(String path) async => {};
  @override
  Future<Json> put(String path, Json data) async => {};
  @override
  Future<String> exportCsv(String query) async => '';
}

void main() {
  test(
    'a saved report receipt returns home without pretending the server closed it',
    () async {
      final store = MemoryStore()..values['pending'] = 'saved';
      final repo = ReportRepository()..reply = {'id': 'legacy-report'};
      final state = LabState(store: store, repositoryOverride: repo)
        ..pending = {'operationId': 'op1', 'studentId': 'S1'};
      await state.report('Computer did not start');
      expect(state.screen, 'welcome');
      expect(state.pending, isNull);
      expect(state.savedCheckIns.single['operationId'], 'op1');
      expect(store.values['savedCheckIns'], contains('op1'));
      expect(state.reportConfirmation, contains('Staff will check'));
      expect(state.reportConfirmation, isNot(contains('session has ended')));
      state.dispose();
    },
  );

  for (final screen in ['progress', 'session', 'welcome']) {
    testWidgets(
      'report is reachable from $screen and ends the saved session only after confirmation',
      (tester) async {
        tester.view.physicalSize = const Size(1280, 800);
        tester.view.devicePixelRatio = 1.5;
        tester.view.padding = const FakeViewPadding(top: 36, bottom: 72);
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        addTearDown(tester.view.resetPadding);
        final store = MemoryStore()
          ..values['pending'] = '{"operationId":"op1"}';
        final repo = ReportRepository()..response = Completer<Json>();
        final state = LabState(store: store, repositoryOverride: repo)
          ..ready = true
          ..screen = screen
          ..pending = {'operationId': 'op1', 'workstationId': 'PC-01'};
        if (screen == 'session') {
          state.session = {
            'id': 'op1',
            'workstationId': 'PC-01',
            'status': 'active',
          };
        }
        await tester.pumpWidget(ComLabApp(state: state));
        await tester.pumpAndSettle();
        if (find.text('Report a problem').hitTestable().evaluate().isEmpty) {
          await tester.scrollUntilVisible(
            find.text('Report a problem'),
            150,
            scrollable: find.byType(Scrollable).first,
          );
        }
        await tester.ensureVisible(find.text('Report a problem'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Report a problem'));
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(TextField), ' PC did not start ');
        await tester.scrollUntilVisible(
          find.text('Submit report'),
          150,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.ensureVisible(find.text('Submit report'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Submit report'));
        await tester.pump();
        expect(state.pending, isNotNull);
        expect(store.values.containsKey('pending'), isTrue);
        expect(state.busy, isTrue);
        expect(repo.posts, [
          {'sessionId': 'op1', 'description': 'PC did not start'},
        ]);
        repo.response!.complete(repo.reply);
        await tester.pumpAndSettle();
        expect(state.pending, isNull);
        expect(store.values.containsKey('pending'), isFalse);
        expect(state.screen, 'welcome');
        expect(find.textContaining('Your session has ended'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        state.dispose();
      },
    );
  }
  test(
    'an invalid or failed report response cannot discard the saved operation',
    () async {
      final store = MemoryStore()..values['pending'] = 'saved';
      final repo = ReportRepository()..reply = {};
      final state = LabState(store: store, repositoryOverride: repo)
        ..pending = {'operationId': 'op1'};
      await expectLater(state.report('Problem'), throwsA(isA<ApiFailure>()));
      expect(state.pending, isNotNull);
      expect(store.values['pending'], 'saved');
      repo.response = Completer<Json>()
        ..completeError(ApiFailure('Cloud unavailable', 503));
      await expectLater(state.report('Problem'), throwsA(isA<ApiFailure>()));
      expect(state.pending, isNotNull);
      expect(state.reportConfirmation, isNull);
      state.dispose();
    },
  );
}
