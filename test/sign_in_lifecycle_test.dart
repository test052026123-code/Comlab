import 'dart:async';
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
    String? apiOverride,
  }) async {
    requestedApi = apiOverride;
    await response.future;
    screen = 'welcome';
    notifyListeners();
    // A real pending-operation recovery may keep login awaiting after navigation.
    await Future<void>.delayed(const Duration(milliseconds: 100));
  }
}

void main() {
  test(
    'API address recovery rejects unsafe origins and kiosk overrides before authentication',
    () async {
      final state = LabState(store: MemoryStore())
        ..apiUrl = 'https://old.example';
      for (final url in [
        'http://api.example',
        'https://user:secret@api.example',
        'https://api.example/path',
        'https://api.example?token=test',
      ]) {
        await expectLater(
          state.login('unused', 'unused', asAdmin: true, apiOverride: url),
          throwsA(isA<ApiFailure>()),
        );
        expect(state.apiUrl, 'https://old.example');
      }
      await expectLater(
        state.login(
          'unused',
          'unused',
          asAdmin: false,
          apiOverride: 'https://new.example',
        ),
        throwsA(isA<ApiFailure>()),
      );
      expect(state.apiUrl, 'https://old.example');
      state.dispose();
    },
  );
  testWidgets(
    'administrator can supply a replacement API address without losing saved settings on failure',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final state = SignInState()
        ..ready = true
        ..screen = 'login'
        ..apiUrl = 'https://old.example';
      await tester.pumpWidget(ComLabApp(state: state));
      await tester.enterText(
        find.byKey(const ValueKey('admin-api-address')),
        'https://new.example',
      );
      await tester.tap(find.text('Sign in'));
      await tester.pump();
      expect(state.requestedApi, 'https://new.example');
      expect(state.apiUrl, 'https://old.example');
      state.response.completeError(ApiFailure('Account not approved', 403));
      await tester.pumpAndSettle();
      expect(state.apiUrl, 'https://old.example');
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
