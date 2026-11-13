import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk/core/contracts.dart';
import 'package:kiosk/core/lab_state.dart';
import 'package:kiosk/data/services.dart';
import 'widget_test.dart' show MemoryStore;

class ScanRepository implements LabRepository {
  final calls = <String>[];
  String? requestId;
  Json response = {'state': 'waiting'};
  Completer<Json>? startResponse;
  ApiFailure? pollFailure;
  @override
  Future<Json> post(String path, Json data) async {
    calls.add(path);
    if (path == '/fingerprint/requests') {
      requestId = data['requestId'] as String;
      return startResponse == null ? response : await startResponse!.future;
    }
    return {};
  }

  @override
  Future<Json> get(String path) async {
    calls.add(path);
    if (path.startsWith('/fingerprint/requests/') && pollFailure != null) {
      throw pollFailure!;
    }
    return path == '/settings' ? {'welcomeTimeoutSeconds': 25} : response;
  }

  @override
  Future<Json> put(String path, Json data) async => {};
  @override
  Future<String> exportCsv(String query) async => '';
}

void main() {
  testWidgets(
    'transient polling failure retains the scan and recovers its match',
    (tester) async {
      final repo = ScanRepository();
      final state = LabState(store: MemoryStore(), repositoryOverride: repo);
      await state.run(state.startFingerprintScan);
      final id = state.scanRequestId;
      repo.pollFailure = ApiFailure('Connection timed out.', null, true);
      await tester.pump(const Duration(seconds: 2));
      expect(state.fingerprintScanning, isTrue);
      expect(state.scanRequestId, id);
      expect(state.error, isNull);
      expect(repo.calls.where((p) => p.endsWith('/cancel')), isEmpty);
      repo.pollFailure = null;
      repo.response = {
        'state': 'matched',
        'student': {'id': 'S1'},
        'session': null,
      };
      await tester.pump(const Duration(seconds: 2));
      expect(state.student?['id'], 'S1');
      expect(state.screen, 'confirm');
      expect(repo.calls.where((p) => p == '/fingerprint/requests').length, 1);
      expect(
        repo.calls.where((p) => p == '/fingerprint/requests/$id').length,
        2,
      );
      state.dispose();
    },
  );

  testWidgets(
    'continuous connection failures stop at a bounded scan deadline',
    (tester) async {
      final repo = ScanRepository();
      final state = LabState(store: MemoryStore(), repositoryOverride: repo);
      await state.run(state.startFingerprintScan);
      repo.pollFailure = ApiFailure('Unavailable.', 503, true);
      await tester.pump(const Duration(seconds: 2));
      expect(state.fingerprintScanning, isTrue);
      await tester.pump(const Duration(seconds: 70));
      expect(state.fingerprintScanning, isFalse);
      expect(state.scanRequestId, isNull);
      expect(state.student, isNull);
      expect(state.error, contains('Scan timed out'));
      expect(repo.calls.where((p) => p.endsWith('/cancel')).length, 1);
      final calls = repo.calls.length;
      await tester.pump(const Duration(seconds: 10));
      expect(repo.calls.length, calls);
      state.dispose();
    },
  );

  testWidgets('authorization failures stop polling without retrying', (
    tester,
  ) async {
    final repo = ScanRepository();
    final state = LabState(store: MemoryStore(), repositoryOverride: repo);
    await state.run(state.startFingerprintScan);
    repo.pollFailure = ApiFailure('Not approved.', 403);
    await tester.pump(const Duration(seconds: 2));
    expect(state.fingerprintScanning, isFalse);
    expect(state.error, contains('Not approved'));
    expect(state.student, isNull);
    state.dispose();
  });

  testWidgets(
    'scan polls the requested match and loads the student without ID lookup',
    (tester) async {
      final repo = ScanRepository();
      final state = LabState(store: MemoryStore(), repositoryOverride: repo);
      await state.run(state.startFingerprintScan);
      expect(state.fingerprintScanning, isTrue);
      expect(state.student, isNull);
      repo.response = {
        'state': 'matched',
        'student': {'id': 'S1', 'name': 'Student'},
        'session': null,
      };
      await tester.pump(const Duration(seconds: 2));
      expect(state.screen, 'confirm');
      expect(state.student?['id'], 'S1');
      expect(state.scanRequestId, repo.requestId);
      expect(state.fingerprintScanning, isFalse);
      expect(repo.calls, isNot(contains('/lookup')));
      state.resetStudent();
      expect(state.scanRequestId, isNull);
      expect(state.student, isNull);
      state.dispose();
    },
  );

  testWidgets('no-match and expired scans never select a student', (
    tester,
  ) async {
    for (final result in ['no_match', 'unlinked', 'expired', 'error']) {
      final repo = ScanRepository();
      final state = LabState(store: MemoryStore(), repositoryOverride: repo);
      await state.run(state.startFingerprintScan);
      repo.response = {'state': result};
      await tester.pump(const Duration(seconds: 2));
      expect(state.student, isNull);
      expect(state.error, isNotNull);
      expect(state.fingerprintScanning, isFalse);
      expect(state.scanRequestId, isNull);
      state.dispose();
    }
  });

  testWidgets(
    'navigation ignores an outstanding response and cancels the request',
    (tester) async {
      final repo = ScanRepository()..startResponse = Completer<Json>();
      final state = LabState(store: MemoryStore(), repositoryOverride: repo);
      final action = state.run(state.startFingerprintScan);
      state.navigate('login');
      repo.startResponse!.complete({
        'state': 'matched',
        'student': {'id': 'S1'},
        'session': null,
      });
      await action;
      expect(state.screen, 'login');
      expect(state.student, isNull);
      expect(state.scanRequestId, isNull);
      expect(repo.calls.any((path) => path.endsWith('/cancel')), isTrue);
      state.dispose();
    },
  );

  test(
    'pending operations are archived so the next student can scan',
    () async {
      final repo = ScanRepository();
      final state = LabState(store: MemoryStore(), repositoryOverride: repo)
        ..pending = {'operationId': 'saved'};
      await state.run(state.startFingerprintScan);
      expect(state.error, isNull);
      expect(state.pending, isNull);
      expect(state.savedCheckIns.single['operationId'], 'saved');
      expect(repo.calls, ['/fingerprint/requests']);
      state.dispose();
    },
  );
}
