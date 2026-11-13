import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk/core/contracts.dart';
import 'package:kiosk/core/lab_state.dart';
import 'package:kiosk/data/services.dart';
import 'package:kiosk/ui/settings.dart';

class DiagnosticsRepository implements LabRepository {
  String transport = 'cloud';
  String? failedPath;
  final reads = <String>[];
  @override
  Future<Json> get(String path) async {
    reads.add(path);
    if (path == failedPath) throw ApiFailure('Cloud request timed out');
    return path == '/health'
        ? {'firebase': 'reachable', 'controllerTransport': transport}
        : {'connected': true, 'reportedNodes': 1};
  }

  @override
  Future<Json> post(String path, Json data) async => {};
  @override
  Future<Json> put(String path, Json data) async => {};
  @override
  Future<String> exportCsv(String query) async => '';
}

class DiagnosticsDevice implements DeviceGateway {
  int healthReads = 0, nodeReads = 0;
  @override
  Future<Json> health() async {
    healthReads++;
    return {};
  }

  @override
  Future<Json> nodes() async {
    nodeReads++;
    return {'nodes': []};
  }

  @override
  Future<Json> result(String commandId) async => {};
  @override
  Future<Json> submit(Json command) async =>
      throw StateError('Diagnostics must not send commands');
}

class DiagnosticsStore implements PrivateStore {
  @override
  Future<String?> read(String key) async => null;
  @override
  Future<void> write(String key, String? value) async {}
}

void main() {
  for (final failedPath in <String?>[null, '/health', '/controller/status']) {
    testWidgets('cloud diagnostics never try LAN after $failedPath', (
      tester,
    ) async {
      final repo = DiagnosticsRepository()..failedPath = failedPath;
      final device = DiagnosticsDevice();
      final state = LabState(
        store: DiagnosticsStore(),
        repositoryOverride: repo,
        devicesOverride: device,
      )..admin = true;
      addTearDown(state.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: SettingsScreen(state: state)),
        ),
      );
      await tester.scrollUntilVisible(
        find.text('Run connectivity diagnostics'),
        500,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.text('Run connectivity diagnostics'));
      await tester.pumpAndSettle();
      expect(device.healthReads, 0);
      expect(device.nodeReads, 0);
      if (failedPath == null) {
        expect(
          find.textContaining('Controller via cloud: connected'),
          findsOneWidget,
        );
      } else {
        expect(find.textContaining('Cloud request timed out'), findsOneWidget);
        expect(
          find.textContaining('Local controller from tablet:'),
          findsNothing,
        );
        if (failedPath == '/controller/status') {
          expect(
            find.textContaining('Firebase via trusted API: reachable'),
            findsOneWidget,
          );
          expect(repo.reads, ['/health', '/controller/status']);
        } else {
          expect(repo.reads, ['/health']);
        }
      }
    });
  }

  testWidgets('explicit LAN mode still checks the local controller', (
    tester,
  ) async {
    final repo = DiagnosticsRepository()..transport = 'lan';
    final device = DiagnosticsDevice();
    final state = LabState(
      store: DiagnosticsStore(),
      repositoryOverride: repo,
      devicesOverride: device,
    )..admin = true;
    addTearDown(state.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: SettingsScreen(state: state)),
      ),
    );
    await tester.scrollUntilVisible(
      find.text('Run connectivity diagnostics'),
      500,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Run connectivity diagnostics'));
    await tester.pumpAndSettle();
    expect(device.healthReads, 1);
    expect(device.nodeReads, 1);
    expect(
      find.textContaining('Local controller from tablet: reachable'),
      findsOneWidget,
    );
  });
}
