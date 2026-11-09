import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kiosk/core/contracts.dart';
import 'package:kiosk/core/lab_state.dart';
import 'package:kiosk/data/services.dart';
import 'package:kiosk/ui/app.dart';

class MemoryStore implements PrivateStore {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String? value) async {
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
  }
}

class TestRepository implements LabRepository {
  Json op = {
    'session': {'id': 'saved-op', 'workstationId': 'PC-01', 'status': 'active'},
    'command': null,
  };
  final posts = <String>[];
  Completer<void>? wait;
  @override
  Future<Json> get(String path) async => op;
  @override
  Future<Json> post(String path, Json data) async {
    posts.add(path);
    if (wait != null) await wait!.future;
    return op;
  }

  @override
  Future<Json> put(String path, Json data) async => {};
  @override
  Future<String> exportCsv(String query) async => '';
}

class TestDevice implements DeviceGateway {
  int submissions = 0;
  @override
  Future<Json> submit(Json command) async {
    submissions++;
    return {'state': 'accepted'};
  }

  @override
  Future<Json> result(String id) async => {'state': 'accepted'};
  @override
  Future<Json> health() async => {};
  @override
  Future<Json> nodes() async => {};
}

void main() {
  test(
    'cloud commands reconcile through the API without any LAN submission',
    () async {
      final repo = TestRepository()
        ..op = {
          'session': {
            'id': 'cloud-op',
            'workstationId': 'PC-01',
            'status': 'active',
          },
          'command': {
            'commandId': 'cloud-op',
            'state': 'pending',
            'delivery': 'cloud',
          },
        };
      final device = TestDevice();
      final state =
          LabState(
              store: MemoryStore(),
              repositoryOverride: repo,
              devicesOverride: device,
            )
            ..operation = repo.op
            ..pending = {'operationId': 'cloud-op'};
      await state.dispatchNewCommand();
      expect(device.submissions, 0);
      expect(repo.posts, ['/operations/cloud-op/reconcile']);
      expect(state.pending, isNotNull);
      state.dispose();
    },
  );
  test(
    'cloud reconciliation failure retains pending work and never falls back to a LAN pulse',
    () async {
      final device = TestDevice();
      final state =
          LabState(
              store: MemoryStore(),
              devicesOverride: device,
              repositoryOverride: CloudRepository(
                'https://unit.example',
                () async => 'unit-token',
                client: MockClient(
                  (_) async => http.Response('{"error":"Unit offline"}', 503),
                ),
              ),
            )
            ..operation = {
              'session': {'id': 'cloud-op'},
              'command': {'state': 'pending', 'delivery': 'cloud'},
            }
            ..pending = {'operationId': 'cloud-op'};
      await expectLater(state.dispatchNewCommand(), throwsA(isA<ApiFailure>()));
      expect(state.pending, isNotNull);
      expect(device.submissions, 0);
      state.dispose();
    },
  );
  test(
    'admin workflow reset cannot expose a privileged student welcome',
    () async {
      final state = LabState(store: MemoryStore())..admin = true;
      state.resetStudent();
      expect(state.screen, 'admin');
      await state.leaveAdmin();
      expect(state.admin, false);
      expect(state.screen, 'setup');
      state.dispose();
    },
  );
  test(
    'administrator record IDs normalize without acting as fingerprint identification',
    () {
      final id = StudentIdIdentification();
      expect(id.normalize(' ab-123 '), 'AB-123');
      expect(id.label, 'Student record ID');
      expect(() => id.normalize('bad/id'), throwsFormatException);
    },
  );
  test('confirmed-on assignment does not send a power pulse', () async {
    final repo = TestRepository(), device = TestDevice(), store = MemoryStore();
    final state = LabState(
      store: store,
      repositoryOverride: repo,
      devicesOverride: device,
    )..student = {'id': 'S1'};
    await state.reserve('PC-01');
    expect(device.submissions, 0);
    expect(state.pending, isNull);
    expect(state.screen, 'session');
    state.dispose();
  });
  test(
    'restart recovery reconciles accepted command and never submits it',
    () async {
      final repo = TestRepository()
        ..op = {
          'session': {'id': 'saved-op', 'workstationId': 'PC-01'},
          'command': {'state': 'accepted', 'commandId': 'saved-op'},
        };
      final device = TestDevice(),
          state = LabState(
            store: MemoryStore(),
            repositoryOverride: repo,
            devicesOverride: device,
          )..pending = {'operationId': 'saved-op'};
      await state.recover();
      expect(device.submissions, 0);
      expect(state.pending, isNotNull);
      expect(state.screen, 'progress');
      state.dispose();
    },
  );
  test('busy guard suppresses repeated taps', () async {
    final repo = TestRepository()..wait = Completer<void>();
    final state = LabState(store: MemoryStore(), repositoryOverride: repo);
    int calls = 0;
    final first = state.run(() async {
      calls++;
      await repo.post('/reserve', {});
    });
    await state.run(() async {
      calls++;
    });
    expect(calls, 1);
    repo.wait!.complete();
    await first;
    state.dispose();
  });
  test('checkout failure retains session and pending operation', () async {
    final state =
        LabState(
            store: MemoryStore(),
            repositoryOverride: CloudRepository(
              'https://api.example',
              () async => 'token',
              client: MockClient(
                (_) async => http.Response('{"error":"Pending command"}', 409),
              ),
            ),
          )
          ..session = {'id': 'saved-op'}
          ..pending = {'operationId': 'saved-op'};
    await expectLater(state.checkout(), throwsA(isA<ApiFailure>()));
    expect(state.session, isNotNull);
    expect(state.pending, isNotNull);
    state.dispose();
  });
  test('controller timeout retry reuses identical command ID', () async {
    final bodies = <String>[];
    final gateway = HttpController(
      'http://comlab-controller.local',
      'test-secret',
      const Duration(seconds: 1),
      client: MockClient((r) async {
        bodies.add(r.body);
        if (bodies.length == 1) throw TimeoutException('uncertain');
        return http.Response(
          jsonEncode({'commandId': 'one', 'state': 'accepted'}),
          202,
        );
      }),
    );
    final result = await gateway.submit({
      'commandId': 'one',
      'workstationId': 'PC-01',
      'nodeId': 'NODE-01',
      'action': 'power_on',
    });
    expect(result['state'], 'accepted');
    expect(bodies.length, 2);
    expect(bodies[0], bodies[1]);
  });
  test('cleartext controller cannot target arbitrary hosts', () {
    final gateway = HttpController(
      'http://192.168.1.2',
      'secret',
      const Duration(seconds: 1),
    );
    expect(() => gateway.endpoint('/health'), throwsA(isA<ApiFailure>()));
  });
  for (final size in [const Size(1280, 800), const Size(800, 1280)]) {
    testWidgets('welcome renders with no student records at $size', (
      tester,
    ) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final state = LabState(store: MemoryStore())..ready = true;
      await tester.pumpWidget(ComLabApp(state: state));
      expect(
        find.byKey(const ValueKey('fingerprint-scan-button')),
        findsOneWidget,
      );
      expect(find.byType(TextField), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    });
  }
  testWidgets('missing Firebase configuration shows honest setup state', (
    tester,
  ) async {
    final state = LabState(store: MemoryStore());
    await state.initialize();
    await tester.pumpWidget(ComLabApp(state: state));
    expect(find.textContaining('Firebase setup required'), findsOneWidget);
    expect(find.text('No students'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });
}
