import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk/core/contracts.dart';
import 'package:kiosk/core/lab_state.dart';
import 'package:kiosk/data/services.dart';
import 'package:kiosk/ui/app.dart';
import 'widget_test.dart' show MemoryStore, TestDevice;

class SavedSessionRepository implements LabRepository {
  final gets = <String>[], posts = <String>[];
  ApiFailure? readFailure;
  Json operation = {
    'session': {
      'id': 'saved-op',
      'commandId': 'saved-op',
      'workstationId': 'PC-01',
      'studentId': 'S1',
      'name': 'Mark Brian',
      'section': '4B',
      'status': 'active',
    },
    'command': {
      'commandId': 'saved-op',
      'state': 'unknown',
      'delivery': 'cloud',
    },
  };
  @override
  Future<Json> get(String path) async {
    gets.add(path);
    if (readFailure != null) throw readFailure!;
    return operation;
  }

  @override
  Future<Json> post(String path, Json data) async {
    posts.add(path);
    if (path == '/reserve') {
      final id = data['operationId'];
      operation = {
        'session': {...operation['session'] as Json, 'id': id, 'commandId': id},
        'command': {...operation['command'] as Json, 'commandId': id},
      };
    }
    return operation;
  }

  @override
  Future<Json> put(String path, Json data) async => {};
  @override
  Future<String> exportCsv(String query) async => '';
}

void main() {
  testWidgets(
    'unknown startup restores the active session and persists a resumable journal',
    (tester) async {
      final repo = SavedSessionRepository(),
          device = TestDevice(),
          store = MemoryStore();
      final state =
          LabState(
              store: store,
              repositoryOverride: repo,
              devicesOverride: device,
            )
            ..ready = true
            ..pending = {'operationId': 'saved-op', 'studentId': 'S1'};
      await state.run(state.recover);
      expect(state.screen, 'session');
      expect(state.session?['status'], 'active');
      expect(state.startupUnverified, isTrue);
      expect(state.hasSavedReservation, isTrue);
      expect(state.pending?['operationId'], 'saved-op');
      expect(
        jsonDecode(store.values['pending']!)['reservationConfirmed'],
        isTrue,
      );
      expect(device.submissions, 0);
      expect(
        repo.posts,
        isEmpty,
      ); // GET of authoritative state is enough to restore it.
      await tester.pump(const Duration(seconds: 10));
      expect(repo.gets, [
        '/operations/saved-op',
      ]); // No endless background reconciliation.

      state.resetStudent();
      await tester.pumpWidget(ComLabApp(state: state));
      expect(find.text('Resume session'), findsOneWidget);
      expect(
        find.textContaining('previous operation needs reconciliation'),
        findsNothing,
      );
      await tester.tap(find.text('Resume session'));
      await tester.pumpAndSettle();
      expect(state.screen, 'session');
      expect(find.textContaining('Startup unverified.'), findsNothing);
      expect(find.text('Power: confirmed_on'), findsNothing);
      expect(find.text('Report a problem'), findsOneWidget);
      expect(find.text('Check out'), findsNothing);
      expect(device.submissions, 0);
      expect(repo.posts, isEmpty);
      await tester.pumpWidget(const SizedBox.shrink());
      state.dispose();

      final restarted = LabState(
        store: store,
        repositoryOverride: repo,
        devicesOverride: device,
      )..pending = jsonDecode(store.values['pending']!) as Json;
      await restarted.run(restarted.recover);
      expect(restarted.screen, 'session');
      expect(restarted.hasSavedReservation, isTrue);
      expect(device.submissions, 0);
      restarted.dispose();
    },
  );

  test(
    'fresh reservation with unverified startup opens its session without another pulse',
    () async {
      final repo = SavedSessionRepository(), device = TestDevice();
      final state =
          LabState(
              store: MemoryStore(),
              repositoryOverride: repo,
              devicesOverride: device,
            )
            ..student = {'id': 'S1'}
            ..cloudFresh = true;
      await state.reserve('PC-01');
      expect(state.screen, 'session');
      expect(state.hasSavedReservation, isTrue);
      expect(state.cloudFresh, isFalse);
      expect(repo.posts.where((p) => p == '/reserve').length, 1);
      expect(device.submissions, 0);
      state.dispose();
    },
  );

  test(
    'unknown record without a matching active reservation stays unresolved',
    () async {
      for (final mismatch in ['inactive', 'session', 'command']) {
        final repo = SavedSessionRepository();
        if (mismatch == 'inactive') {
          (repo.operation['session'] as Json)['status'] = 'closed';
        }
        if (mismatch == 'session') {
          (repo.operation['session'] as Json)['id'] = 'other-session';
        }
        if (mismatch == 'command') {
          (repo.operation['command'] as Json)['commandId'] = 'other-command';
        }
        final state = LabState(store: MemoryStore(), repositoryOverride: repo)
          ..pending = {'operationId': 'saved-op'};
        await state.run(state.recover);
        expect(state.screen, 'progress');
        expect(state.hasSavedReservation, isFalse);
        expect(state.pending?['operationId'], 'saved-op');
        state.dispose();
      }
    },
  );

  test(
    'a deleted resumed session retains its ID but loses the confirmed-reservation marker',
    () async {
      final repo = SavedSessionRepository()
        ..readFailure = ApiFailure('Missing', 404);
      final store = MemoryStore();
      final state = LabState(store: store, repositoryOverride: repo)
        ..pending = {'operationId': 'saved-op', 'reservationConfirmed': true};
      await state.run(state.recover);
      expect(state.hasSavedReservation, isFalse);
      expect(state.pending?['operationId'], 'saved-op');
      expect(state.error, contains('saved session is missing'));
      expect(
        jsonDecode(
          store.values['pending']!,
        ).containsKey('reservationConfirmed'),
        isFalse,
      );
      state.dispose();
    },
  );

  test(
    'later authoritative confirmation clears only the local unresolved journal',
    () async {
      final repo = SavedSessionRepository(),
          store = MemoryStore(),
          device = TestDevice();
      final state = LabState(
        store: store,
        repositoryOverride: repo,
        devicesOverride: device,
      )..pending = {'operationId': 'saved-op'};
      await state.run(state.recover);
      (repo.operation['command'] as Json)['state'] = 'confirmed_on';
      await state.run(state.recover);
      expect(state.screen, 'session');
      expect(state.startupUnverified, isFalse);
      expect(state.pending, isNull);
      expect(store.values['pending'], isNull);
      expect(device.submissions, 0);
      expect(repo.posts, ['/operations/saved-op/reconcile']);
      state.dispose();
    },
  );
}
