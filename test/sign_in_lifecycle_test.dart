import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk/core/lab_state.dart';
import 'package:kiosk/data/services.dart';
import 'package:kiosk/ui/app.dart';
import 'widget_test.dart' show MemoryStore;

class SignInState extends LabState {
  SignInState() : super(store: MemoryStore());
  Completer<void> response = Completer<void>();
  String? requestedApi;
  @override
  Future<void> login(
    String email,
    String password, {
    required bool asAdmin,
  }) async {
    requestedApi = apiUrl;
    await response.future;
    screen = 'welcome';
    notifyListeners();
    // A real pending-operation recovery may keep login awaiting after navigation.
    await Future<void>.delayed(const Duration(milliseconds: 100));
  }
}

void main() {
  test(
    'fresh installs and saved tunnel settings use the fixed Render origin',
    () async {
      for (final oldApi in [null, 'https://expired.trycloudflare.com']) {
        final store = MemoryStore();
        if (oldApi != null) {
          store.values['settings'] = jsonEncode({
            'apiUrl': oldApi,
            'controllerUrl': 'http://comlab-controller.local',
            'timeoutMs': 7000,
          });
          store.values['pairing'] = 'unit-test-pairing';
        }
        final state = LabState(store: store);
        expect(state.apiUrl, 'https://comlab-api.onrender.com');
        await state.initialize();
        expect(state.apiUrl, 'https://comlab-api.onrender.com');
        if (oldApi != null) {
          expect(state.controllerUrl, 'http://comlab-controller.local');
          expect(state.timeoutMs, 7000);
          expect(state.pairingToken, 'unit-test-pairing');
        }
        state.dispose();
      }
    },
  );
  testWidgets(
    'administrator sign-in uses the fixed origin without an address entry field',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final state = SignInState()
        ..ready = true
        ..screen = 'login';
      await tester.pumpWidget(ComLabApp(state: state));
      expect(find.byKey(const ValueKey('admin-api-address')), findsNothing);
      expect(
        find.widgetWithText(TextField, 'Trusted API HTTPS address'),
        findsNothing,
      );
      await tester.tap(find.text('Sign in'));
      await tester.pump();
      expect(state.requestedApi, 'https://comlab-api.onrender.com');
      expect(state.apiUrl, 'https://comlab-api.onrender.com');
      state.response.completeError(ApiFailure('Account not approved', 403));
      await tester.pumpAndSettle();
      expect(state.apiUrl, 'https://comlab-api.onrender.com');
      expect(find.text('Account not approved'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    },
  );
  testWidgets(
    'focused sign-in survives failure, retry and asynchronous navigation',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final state = SignInState()
        ..ready = true
        ..screen = 'setup';
      await tester.pumpWidget(ComLabApp(state: state));
      expect(
        find.widgetWithText(TextField, 'Trusted API HTTPS address'),
        findsNothing,
      );
      final password = find.widgetWithText(TextField, 'Kiosk account password');
      await tester.ensureVisible(password);
      await tester.enterText(password, 'test-only-password');
      await tester.tap(find.text('Authenticate kiosk'));
      await tester.pump();
      state.response.completeError(ApiFailure('Test sign-in failure', 401));
      await tester.pumpAndSettle();
      expect(find.text('Test sign-in failure'), findsOneWidget);
      state.response = Completer<void>();
      await tester.tap(find.text('Authenticate kiosk'));
      await tester.pump();
      state.response.complete();
      await tester.pump();
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(state.error, isNull);
      expect(state.screen, 'welcome');
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    },
  );
}
