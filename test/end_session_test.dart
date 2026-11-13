import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk/core/contracts.dart';
import 'package:kiosk/core/lab_state.dart';
import 'package:kiosk/data/services.dart';
import 'package:kiosk/ui/app.dart';
import 'widget_test.dart' show MemoryStore;

/// Second scan of a student who already has an active, powered-on session.
class ReturningStudentRepository implements LabRepository {
  final posts = <String, Json>{};
  ApiFailure? closeFailure;
  String? requestId;

  @override
  Future<Json> post(String path, Json data) async {
    posts[path] = data;
    if (path == '/fingerprint/requests') {
      requestId = data['requestId'] as String;
      return {
        'state': 'matched',
        'student': {'id': 'S1', 'name': 'Ana Cruz'},
        'session': {
          'id': 'session-1',
          'studentId': 'S1',
          'workstationId': 'PC-03',
          'status': 'active',
          // Cloud reservations always carry a power command ID.
          'commandId': 'session-1',
        },
      };
    }
    if (path.endsWith('/close') && closeFailure != null) throw closeFailure!;
    return {'closed': true};
  }

  @override
  Future<Json> get(String path) async =>
      path == '/settings' ? {'welcomeTimeoutSeconds': 25} : {};
  @override
  Future<Json> put(String path, Json data) async => {};
  @override
  Future<String> exportCsv(String query) async => '';
}

Future<(LabState, ReturningStudentRepository)> _scanIn(
  WidgetTester tester,
) async {
  tester.view.physicalSize = const Size(1280, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final repo = ReturningStudentRepository();
  final state = LabState(store: MemoryStore(), repositoryOverride: repo)
    ..ready = true;
  await tester.pumpWidget(ComLabApp(state: state));
  await state.run(state.startFingerprintScan);
  await tester.pumpAndSettle();
  return (state, repo);
}

void main() {
  final question = find.byKey(const ValueKey('end-session-question'));

  testWidgets('second scan asks to end the session and ends it on Yes', (
    tester,
  ) async {
    final (state, repo) = await _scanIn(tester);
    expect(state.screen, 'session');
    expect(question, findsOneWidget);
    expect(find.text('End your session?'), findsOneWidget);
    expect(find.textContaining('You are using PC-03.'), findsOneWidget);

    await tester.tap(find.text('Yes, end session'));
    await tester.pumpAndSettle();

    expect(question, findsNothing);
    expect(
      repo.posts['/sessions/session-1/close']?['scanRequestId'],
      repo.requestId,
    );
    expect(state.screen, 'welcome');
    expect(state.session, isNull);
    expect(state.student, isNull);
    expect(find.text('Session ended on PC-03. Thank you!'), findsOneWidget);

    // The confirmation clears when the next student scans.
    await state.run(state.startFingerprintScan);
    expect(state.sessionEndConfirmation, isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    state.dispose();
  });

  testWidgets('No keeps the session; End session asks again', (tester) async {
    final (state, repo) = await _scanIn(tester);
    await tester.tap(find.text('No'));
    await tester.pumpAndSettle();
    expect(question, findsNothing);
    expect(state.screen, 'session');
    expect(repo.posts.keys.where((p) => p.endsWith('/close')), isEmpty);

    await tester.tap(find.text('End session'));
    await tester.pumpAndSettle();
    expect(question, findsOneWidget);
    await tester.tap(find.text('No'));
    await tester.pumpAndSettle();
    expect(repo.posts.keys.where((p) => p.endsWith('/close')), isEmpty);
    await tester.pumpWidget(const SizedBox.shrink());
    state.dispose();
  });

  testWidgets('Report a problem from the question opens the report form', (
    tester,
  ) async {
    final (state, repo) = await _scanIn(tester);
    await tester.tap(
      find.descendant(of: question, matching: find.text('Report a problem')),
    );
    await tester.pumpAndSettle();
    expect(state.screen, 'issue');
    expect(repo.posts.keys.where((p) => p.endsWith('/close')), isEmpty);
    await tester.pumpWidget(const SizedBox.shrink());
    state.dispose();
  });

  testWidgets('a refused end shows the reason inside the question', (
    tester,
  ) async {
    final (state, repo) = await _scanIn(tester);
    repo.closeFailure = ApiFailure(
      'Power delivery is pending or unknown. Reconcile before releasing this PC.',
      409,
    );
    await tester.tap(find.text('Yes, end session'));
    await tester.pumpAndSettle();
    expect(find.text('Session not ended'), findsOneWidget);
    expect(find.textContaining('Use Report a problem'), findsOneWidget);
    expect(state.screen, 'session');
    expect(state.session?['id'], 'session-1');
    expect(state.sessionEndConfirmation, isNull);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    expect(question, findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    state.dispose();
  });

  test(
    'a saved check-in deleted by staff is forgotten on the next scan',
    () async {
      final repo = _DeletedSavedRepository();
      final store = MemoryStore()
        ..values['savedCheckIns'] =
            '[{"operationId":"old-op","studentId":"S1","reservationConfirmed":true}]';
      final state = LabState(store: store, repositoryOverride: repo);
      await state.loadSavedCheckIns();
      await state.run(state.startFingerprintScan);
      expect(state.error, isNull);
      expect(state.screen, 'confirm');
      expect(state.savedCheckIns, isEmpty);
      expect(store.values.containsKey('savedCheckIns'), isFalse);
      state.dispose();
    },
  );

  testWidgets('idle return home closes a refused end question', (tester) async {
    final (state, repo) = await _scanIn(tester);
    repo.closeFailure = ApiFailure('Assignment integrity error.', 409);
    await tester.tap(find.text('Yes, end session'));
    await tester.pumpAndSettle();
    expect(find.text('Session not ended'), findsOneWidget);
    await tester.pump(const Duration(seconds: 61));
    await tester.pumpAndSettle();
    expect(state.screen, 'welcome');
    expect(question, findsNothing);
    expect(find.text('Scan fingerprint'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    state.dispose();
  });

  testWidgets('only a fresh scan offers ending, even with unverified power', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1280, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    LabState build({String? scan}) =>
        LabState(
            store: MemoryStore(),
            repositoryOverride: ReturningStudentRepository(),
          )
          ..ready = true
          ..screen = 'session'
          ..scanRequestId = scan
          ..student = {'id': 'S1', 'name': 'Ana Cruz'}
          ..session = {
            'id': 'session-1',
            'workstationId': 'PC-01',
            'status': 'active',
            'commandId': 'session-1',
          }
          ..operation = {
            'command': {'commandId': 'session-1', 'state': 'unknown'},
          };
    // Resume session without a scan: the server could not verify the student.
    final resumed = build();
    expect(resumed.startupUnverified, isTrue);
    await tester.pumpWidget(ComLabApp(state: resumed));
    await tester.pumpAndSettle();
    expect(question, findsNothing);
    expect(find.text('End session'), findsNothing);
    expect(find.text('Report a problem'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    resumed.dispose();

    final scanned = build(scan: '00000000-0000-4000-8000-000000000001');
    await tester.pumpWidget(ComLabApp(state: scanned));
    await tester.pumpAndSettle();
    expect(question, findsOneWidget);
    expect(find.text('End session'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    scanned.dispose();
  });
}

/// The student's saved session was removed from the server by staff.
class _DeletedSavedRepository implements LabRepository {
  @override
  Future<Json> post(String path, Json data) async => {
    'state': 'matched',
    'student': {'id': 'S1', 'name': 'Ana Cruz'},
    'session': null,
  };

  @override
  Future<Json> get(String path) async {
    if (path == '/settings') return {'welcomeTimeoutSeconds': 25};
    throw ApiFailure('Operation not found.', 404);
  }

  @override
  Future<Json> put(String path, Json data) async => {};
  @override
  Future<String> exportCsv(String query) async => '';
}
