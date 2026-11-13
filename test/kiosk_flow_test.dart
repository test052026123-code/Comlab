import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kiosk/kiosk/api.dart';
import 'package:kiosk/main.dart';

/// Fake Pi server. `fingerprint` decides what the next scan returns.
class FakePi {
  String fingerprint = 'matched';
  Map<String, dynamic>? openSession;
  final calls = <String>[];
  final pcs = [
    {'id': 'PC-01', 'label': 'PC 1', 'status': 'IDLE', 'mapX': 0, 'mapY': 0},
    {'id': 'PC-02', 'label': 'PC 2', 'status': 'IN_USE', 'mapX': 0, 'mapY': 0},
    {'id': 'PC-03', 'label': 'PC 3', 'status': 'OFF', 'mapX': 0, 'mapY': 0},
  ];

  http.Response _json(Object body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

  MockClient client() => MockClient((req) async {
    final path = req.url.path;
    calls.add('${req.method} $path');
    if (path == '/workstations/live') return _json({'workstations': pcs});
    if (path == '/settings/kiosk') return _json({'autoAssignAfterSeconds': 30, 'welcomeTimeoutSeconds': 25});
    if (path == '/fingerprint/identify') return _json({'id': 'job-1', 'state': 'waiting'});
    if (path == '/fingerprint/requests/job-1') {
      return switch (fingerprint) {
        'matched' => _json({'state': 'matched', 'scanId': 'scan-1', 'message': 'ok'}),
        'no_match' => _json({'state': 'no_match', 'message': 'Fingerprint not recognised. Try again or ask the administrator.'}),
        'timeout' => _json({'state': 'error', 'message': 'No finger detected. Try again.'}),
        _ => _json({'state': 'waiting', 'message': 'Place your finger on the scanner.'}),
      };
    }
    if (path == '/scans/scan-1') {
      return _json({'type': 'student', 'student': {'id': '2024-001', 'name': 'Ana', 'section': 'BSIT 2A'},
        'openSession': openSession, 'currentClass': {'subject': 'IT201'}});
    }
    if (path == '/checkin') {
      final body = jsonDecode(req.body) as Map;
      return _json({'sessionId': 's1', 'workstationId': body['workstationId'] ?? 'PC-01', 'label': body['workstationId'] == 'PC-03' ? 'PC 3' : 'PC 1',
        'assignment': body.containsKey('workstationId') ? 'manual' : 'auto', 'powerOnRequired': body['workstationId'] == 'PC-03'});
    }
    if (path == '/sessions/s9/end') return _json({'ended': true});
    if (path == '/issues/report') return _json({'issueId': 'i1', 'sessionEnded': true});
    return _json({'error': 'not found'}, 404);
  });
}

Future<FakePi> boot(WidgetTester t) async {
  t.view.physicalSize = const Size(1920, 1200);
  t.view.devicePixelRatio = 1.5;
  addTearDown(t.view.reset);
  final pi = FakePi();
  final api = KioskApi(client: pi.client())..token = 'kiosk-token';
  await t.pumpWidget(KioskApp(api: api));
  await t.pumpAndSettle();
  return pi;
}

Future<void> scan(WidgetTester t) async {
  await t.tap(find.text('Tap to scan fingerprint'));
  await t.pump();
  await t.pump(const Duration(milliseconds: 500));
  await t.pumpAndSettle();
}

void main() {
  testWidgets('home shows availability and the scan button', (t) async {
    await boot(t);
    expect(find.text('2 of 3 PCs available'), findsOneWidget);
    expect(find.text('Report a problem'), findsOneWidget);
  });

  testWidgets('unrecognised finger shows a modal error alert', (t) async {
    final pi = await boot(t);
    pi.fingerprint = 'no_match';
    await scan(t);
    expect(find.text('Fingerprint not recognised'), findsOneWidget);
    expect(find.byIcon(Icons.error_rounded), findsOneWidget);
    await t.tap(find.text('OK'));
    await t.pumpAndSettle();
    expect(find.text('Tap to scan fingerprint'), findsOneWidget);
  });

  testWidgets('no finger shows a warning alert that closes by itself', (t) async {
    final pi = await boot(t);
    pi.fingerprint = 'timeout';
    await scan(t);
    expect(find.text('No finger detected'), findsOneWidget);
    await t.pump(const Duration(seconds: 9));
    await t.pumpAndSettle();
    expect(find.text('No finger detected'), findsNothing);
  });

  testWidgets('pick a PC manually, confirm, success alert, back home', (t) async {
    final pi = await boot(t);
    await scan(t);
    expect(find.text('Hi, Ana! Choose a PC'), findsOneWidget);
    await t.tap(find.text('PC 2')); // in use: not selectable
    await t.pump();
    expect(find.text('Tap a green PC'), findsOneWidget);
    await t.tap(find.text('PC 3'));
    await t.pump();
    await t.tap(find.text('Confirm PC 3'));
    await t.pumpAndSettle();
    expect(find.text('Time-in recorded'), findsOneWidget);
    expect(find.textContaining('turn it on'), findsOneWidget);
    await t.tap(find.text('Done'));
    await t.pumpAndSettle();
    expect(find.text('Tap to scan fingerprint'), findsOneWidget);
    expect(pi.calls, contains('POST /checkin'));
  });

  testWidgets('auto-assigns when the countdown runs out', (t) async {
    await boot(t);
    await scan(t);
    await t.pump(const Duration(seconds: 31));
    await t.pumpAndSettle();
    expect(find.textContaining('You were assigned PC 1'), findsOneWidget);
    await t.tap(find.text('Done'));
    await t.pumpAndSettle();
  });

  testWidgets('student with an open session can time out', (t) async {
    final pi = await boot(t);
    pi.openSession = {'id': 's9', 'workstationId': 'PC-02', 'timeIn': DateTime.now().toUtc().toIso8601String()};
    await scan(t);
    expect(find.text('End session (time out)'), findsOneWidget);
    await t.tap(find.text('End session (time out)'));
    await t.pumpAndSettle();
    expect(find.text('Time-out recorded'), findsOneWidget);
    await t.tap(find.text('Done'));
    await t.pumpAndSettle();
  });

  testWidgets('report a problem requires choosing the problem first', (t) async {
    final pi = await boot(t);
    pi.openSession = {'id': 's9', 'workstationId': 'PC-02', 'timeIn': DateTime.now().toUtc().toIso8601String()};
    await scan(t);
    await t.tap(find.text('Report a problem with this PC'));
    await t.pumpAndSettle();
    await t.tap(find.text('Send report'));
    await t.pumpAndSettle();
    expect(find.text('Choose a problem'), findsOneWidget);
    await t.tap(find.text('OK'));
    await t.pumpAndSettle();
    await t.tap(find.text('No display'));
    await t.tap(find.text('Send report'));
    await t.pumpAndSettle();
    expect(find.text('Report sent'), findsOneWidget);
    expect(pi.calls, contains('POST /issues/report'));
    await t.tap(find.text('Done'));
    await t.pumpAndSettle();
  });
}
