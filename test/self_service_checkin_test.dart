import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk/core/contracts.dart';
import 'package:kiosk/core/lab_state.dart';
import 'package:kiosk/data/services.dart';
import 'package:kiosk/ui/app.dart';
import 'widget_test.dart' show MemoryStore, TestDevice;

class SelfServiceRepository implements LabRepository {
  String scanningStudent = 'S1';
  final sessions = <String, Json>{}, operations = <String, Json>{};
  final posts = <Json>[], reads = <String>[];
  Completer<void>? reserveGate;
  bool loseReserveResponse = false, hideActivePointer = false;
  @override
  Future<Json> get(String path) async {
    reads.add(path);
    if (path == '/settings') return {'welcomeTimeoutSeconds': 25};
    if (path == '/workstations') {
      return {
        'workstations': [
          for (final id in ['PC-01', 'PC-02'])
            {
              'id': id,
              'nodeId': id == 'PC-01' ? 'NODE-01' : 'NODE-02',
              'enabled': true,
              'maintenance': false,
              'eligible': !sessions.values.any((s) => s['workstationId'] == id),
              'node': {'connectivity': 'connected', 'power': 'off'},
            },
        ],
      };
    }
    final op = operations[path.split('/').last];
    if (op == null) throw ApiFailure('Not found', 404);
    return op;
  }

  @override
  Future<Json> post(String path, Json data) async {
    posts.add({'path': path, ...data});
    if (path == '/fingerprint/requests') {
      return {
        'state': 'matched',
        'student': {'id': scanningStudent, 'name': scanningStudent},
        'session': hideActivePointer ? null : sessions[scanningStudent],
      };
    }
    if (path == '/reserve') {
      if (reserveGate != null) await reserveGate!.future;
      final id = data['operationId'] as String;
      final session = <String, dynamic>{
        'id': id,
        'commandId': id,
        'studentId': data['studentId'],
        'workstationId': data['workstationId'],
        'name': data['studentId'],
        'status': 'active',
      };
      sessions[data['studentId'] as String] = session;
      operations[id] = {
        'session': session,
        'command': {'commandId': id, 'state': 'pending', 'delivery': 'cloud'},
      };
      if (loseReserveResponse) throw ApiFailure('Timeout', null, true);
      return operations[id]!;
    }
    if (path == '/issues') {
      final sid = data['sessionId'];
      sessions.removeWhere((_, s) => s['id'] == sid);
      return {'id': sid, 'sessionClosed': true};
    }
    return {};
  }

  @override
  Future<Json> put(String path, Json data) async => {};
  @override
  Future<String> exportCsv(String query) async => '';
}

void main() {
  testWidgets(
    'one confirmation returns home; rescan opens reporting without another start',
    (tester) async {
      final repo = SelfServiceRepository()..reserveGate = Completer<void>();
      final device = TestDevice();
      final state =
          LabState(
              store: MemoryStore(),
              repositoryOverride: repo,
              devicesOverride: device,
            )
            ..ready = true
            ..student = {'id': 'S1', 'name': 'S1'};
      await state.showMap();
      await tester.pumpWidget(ComLabApp(state: state));
      await tester.tap(find.text('PC-01'));
      await tester.pump();
      await tester.tap(find.text('Confirm PC-01'));
      await tester.pumpAndSettle();
      expect(find.text('Start PC-01?'), findsOneWidget);
      expect(repo.posts.where((p) => p['path'] == '/reserve'), isEmpty);
      await tester.tap(find.text('Confirm'));
      await tester.pump();
      expect(find.text('Confirming your selection…'), findsOneWidget);
      expect(find.textContaining('Firebase'), findsNothing);
      repo.reserveGate!.complete();
      await tester.pumpAndSettle();
      expect(state.screen, 'welcome');
      expect(state.pending, isNull);
      expect(find.text('Scan fingerprint'), findsOneWidget);
      expect(state.savedCheckIns.length, 1);
      expect(device.submissions, 0);
      expect(repo.posts.where((p) => p['path'] == '/reserve').length, 1);
      await state.run(state.startFingerprintScan);
      await tester.pumpAndSettle();
      expect(state.screen, 'session');
      // The rescan asks whether to end the session; reporting is offered too.
      final question = find.byKey(const ValueKey('end-session-question'));
      expect(question, findsOneWidget);
      expect(find.textContaining('Startup:'), findsNothing);
      expect(find.textContaining('Firebase'), findsNothing);
      final scanId = state.scanRequestId;
      await tester.tap(
        find.descendant(of: question, matching: find.text('Report a problem')),
      );
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'Computer did not start');
      await tester.scrollUntilVisible(
        find.text('Submit report'),
        150,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.text('Submit report'));
      await tester.pumpAndSettle();
      expect(state.screen, 'welcome');
      expect(state.savedCheckIns, isEmpty);
      expect(repo.posts.last['scanRequestId'], scanId);
      expect(repo.posts.where((p) => p['path'] == '/reserve').length, 1);
      expect(device.submissions, 0);
      await tester.pumpWidget(const SizedBox.shrink());
      state.dispose();
    },
  );

  test(
    'another student can select another PC while the first startup remains unresolved',
    () async {
      final repo = SelfServiceRepository(), device = TestDevice();
      final state = LabState(
        store: MemoryStore(),
        repositoryOverride: repo,
        devicesOverride: device,
      )..student = {'id': 'S1'};
      await state.confirmPcSelection('PC-01');
      repo.scanningStudent = 'S2';
      await state.run(state.startFingerprintScan);
      expect(state.student?['id'], 'S2');
      expect(state.screen, 'confirm');
      expect(repo.reads.where((p) => p.startsWith('/operations/')), isEmpty);
      await state.confirmPcSelection('PC-02');
      expect(state.screen, 'welcome');
      expect(state.pending, isNull);
      expect(state.savedCheckIns.map((r) => r['studentId']), ['S1', 'S2']);
      expect(repo.sessions['S1']?['workstationId'], 'PC-01');
      expect(device.submissions, 0);
      state.dispose();
    },
  );

  test(
    'lost response retains original identity and rescan recovers it without resubmission',
    () async {
      final repo = SelfServiceRepository()..loseReserveResponse = true;
      final state = LabState(store: MemoryStore(), repositoryOverride: repo)
        ..student = {'id': 'S1'};
      await state.run(() => state.confirmPcSelection('PC-01'));
      expect(state.screen, 'welcome');
      expect(state.pending, isNull);
      final id = state.savedCheckIns.single['operationId'];
      repo.hideActivePointer = true;
      await state.run(state.startFingerprintScan);
      expect(state.session?['id'], id);
      expect(state.screen, 'session');
      expect(repo.reads, contains('/operations/$id'));
      expect(repo.posts.where((p) => p['path'] == '/reserve').length, 1);
      state.dispose();
    },
  );

  test(
    'previous saved journal migrates without blocking the next student',
    () async {
      final store = MemoryStore()
        ..values['pending'] = jsonEncode({
          'operationId': 'old-op',
          'studentId': 'S1',
          'workstationId': 'PC-01',
          'reservationConfirmed': true,
        });
      final repo = SelfServiceRepository()..scanningStudent = 'S2';
      final state = LabState(store: store, repositoryOverride: repo);
      await state.loadSavedCheckIns();
      expect(state.pending, isNull);
      expect(store.values['pending'], isNull);
      expect(
        jsonDecode(store.values['savedCheckIns']!).single['operationId'],
        'old-op',
      );
      await state.run(state.startFingerprintScan);
      expect(state.screen, 'confirm');
      expect(state.student?['id'], 'S2');
      expect(repo.reads, isNot(contains('/operations/old-op')));
      state.dispose();
    },
  );
}
