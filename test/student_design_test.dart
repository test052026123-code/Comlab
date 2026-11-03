import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk/core/lab_state.dart';
import 'package:kiosk/data/services.dart';
import 'package:kiosk/ui/app.dart';
import 'package:kiosk/ui/widgets.dart';
import 'widget_test.dart' show MemoryStore;

LabState designState() => LabState(store: MemoryStore())
  ..ready = true
  ..cloudFresh = true
  ..student = {'id': 'TEST-01', 'name': 'Test Student'}
  ..pcs = [
    for (var i = 1; i <= 5; i++)
      {
        'id': 'PC-0$i',
        'nodeId': 'NODE-0$i',
        'enabled': true,
        'eligible': i <= 3,
        'sessionId': i > 3 ? 'test-session-$i' : null,
        'assignment': i > 3 ? 'in use' : 'available',
        'node': {'power': i > 3 ? 'on' : 'off', 'connectivity': 'connected'},
      },
  ];

void main() {
  testWidgets('student request errors preserve keypad and PC card space', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1280, 800);
    tester.view.devicePixelRatio = 1.5;
    tester.view.padding = const FakeViewPadding(top: 36, bottom: 72);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPadding);
    const message =
        'Trusted API unreachable. Check Wi-Fi, HTTPS certificate and internet.';
    for (final screen in ['welcome', 'map']) {
      final state = designState()..screen = screen;
      await tester.pumpWidget(ComLabApp(state: state));
      await tester.pumpAndSettle();
      final target = screen == 'welcome'
          ? find.widgetWithText(OutlinedButton, '1')
          : find.byType(PcCard).first;
      final before = tester.getRect(target);
      await state.run(() async {
        throw ApiFailure(message);
      });
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(tester.getRect(target), before);
      if (screen == 'welcome') {
        expect(tester.getSize(target).height, greaterThanOrEqualTo(40));
      }
      await tester.tap(find.text('View error'));
      await tester.pumpAndSettle();
      expect(find.text(message), findsOneWidget);
      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();
      expect(state.error, isNull);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    }
  });
  testWidgets('U24 Pro density and system bars leave readable full keypad', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1280, 800);
    tester.view.devicePixelRatio = 1.5;
    tester.view.padding = const FakeViewPadding(top: 36, bottom: 72);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPadding);
    addTearDown(tester.view.resetViewInsets);
    final state = designState();
    await tester.pumpWidget(ComLabApp(state: state));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    for (final label in [
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '0',
      'Clear',
    ]) {
      final key = find.widgetWithText(OutlinedButton, label);
      expect(key.hitTestable(), findsOneWidget);
      expect(tester.getSize(key).height, greaterThanOrEqualTo(40));
      final text = tester.getRect(
        find.descendant(of: key, matching: find.text(label)),
      );
      expect(tester.getRect(key).contains(text.topLeft), isTrue);
      expect(tester.getRect(key).contains(text.bottomRight), isTrue);
    }
    expect(
      find.byKey(const ValueKey('continue-button')).hitTestable(),
      findsOneWidget,
    );
    await tester.tap(find.widgetWithText(OutlinedButton, '1'));
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('student-id-entry')))
          .controller!
          .text,
      '1',
    );
    await tester.tap(find.byTooltip('Use letters or symbols'));
    tester.view.viewInsets = const FakeViewPadding(bottom: 300);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(
      find.byKey(const ValueKey('continue-button')).hitTestable(),
      findsOneWidget,
    );
    await tester.enterText(
      find.byKey(const ValueKey('student-id-entry')),
      'ABC-123',
    );
    await tester.tap(find.byTooltip('Use numeric keypad'));
    tester.view.resetViewInsets();
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('student-id-entry')))
          .controller!
          .text,
      'ABC-123',
    );
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });
  testWidgets('letter keyboard keeps ID entry and Continue visible', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1024, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetViewInsets);
    final state = designState();
    await tester.pumpWidget(ComLabApp(state: state));
    await tester.tap(find.byTooltip('Use letters or symbols'));
    tester.view.viewInsets = const FakeViewPadding(bottom: 300);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(
      find.byKey(const ValueKey('student-id-entry')).hitTestable(),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('continue-button')).hitTestable(),
      findsOneWidget,
    );
    expect(
      tester.getRect(find.byKey(const ValueKey('continue-button'))).bottom,
      lessThan(300),
    );
    await tester.enterText(
      find.byKey(const ValueKey('student-id-entry')),
      'ABC-123',
    );
    await tester.tap(find.byTooltip('Use numeric keypad'));
    tester.view.resetViewInsets();
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('student-id-entry')))
          .controller!
          .text,
      'ABC-123',
    );
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });
  testWidgets('tablet check-in and all five PCs fit without page scrolling', (
    tester,
  ) async {
    final originalErrorHandler = FlutterError.onError;
    FlutterError.onError = (details) {
      FlutterError.dumpErrorToConsole(details, forceReport: true);
      originalErrorHandler!(details);
    };
    addTearDown(() => FlutterError.onError = originalErrorHandler);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    for (final size in [
      const Size(800, 600),
      const Size(1024, 600),
      const Size(1024, 640),
      const Size(1280, 800),
      const Size(800, 1280),
    ]) {
      tester.view.physicalSize = size;
      for (final screen in ['welcome', 'map']) {
        final state = designState()..screen = screen;
        await tester.pumpWidget(ComLabApp(state: state));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: '$screen at $size');
        final vertical = tester
            .widgetList<Scrollable>(find.byType(Scrollable))
            .where(
              (w) =>
                  w.axisDirection == AxisDirection.down ||
                  w.axisDirection == AxisDirection.up,
            );
        expect(
          vertical,
          isEmpty,
          reason: 'No page scrolling: $screen at $size',
        );
        final target = find.byKey(
          ValueKey(
            screen == 'welcome' ? 'continue-button' : 'pc-confirmation-bar',
          ),
        );
        expect(
          target.hitTestable(),
          findsOneWidget,
          reason: 'Action visible without scrolling: $screen at $size',
        );
        final bounds = tester.getRect(target);
        expect(bounds.bottom, lessThan(size.height - 40));
        if (screen == 'welcome') {
          final key = find.widgetWithText(OutlinedButton, '1');
          expect(tester.getSize(key).height, greaterThanOrEqualTo(40));
          expect(
            tester
                .widget<TextField>(
                  find.byKey(const ValueKey('student-id-entry')),
                )
                .keyboardType,
            TextInputType.none,
          );
          expect(find.text('Check Out').hitTestable(), findsOneWidget);
        } else {
          expect(find.byType(PcCard), findsNWidgets(5));
          for (var i = 1; i <= 5; i++) {
            expect(find.text('PC-0$i').hitTestable(), findsOneWidget);
          }
        }
        await tester.pumpWidget(const SizedBox());
        state.dispose();
      }
    }
  });
  testWidgets(
    'keypad supports insert, delete and clear without cloud requests',
    (tester) async {
      tester.view.physicalSize = const Size(1280, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final state = designState();
      await tester.pumpWidget(ComLabApp(state: state));
      for (final digit in ['1', '2', '3']) {
        await tester.tap(find.widgetWithText(OutlinedButton, digit));
      }
      final field = tester.widget<TextField>(
        find.byKey(const ValueKey('student-id-entry')),
      );
      expect(field.controller!.text, '123');
      await tester.tap(find.byIcon(Icons.backspace_outlined));
      expect(field.controller!.text, '12');
      field.controller!.selection = const TextSelection(
        baseOffset: 0,
        extentOffset: 1,
      );
      await tester.tap(find.widgetWithText(OutlinedButton, '9'));
      expect(field.controller!.text, '92');
      await tester.tap(find.text('Clear'));
      expect(field.controller!.text, isEmpty);
      await tester.tap(find.text('Check Out'));
      await tester.pump();
      expect(find.text('Find my session'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    },
  );

  testWidgets(
    'PC cards select eligible PCs and disable confirmation when stale',
    (tester) async {
      tester.view.physicalSize = const Size(1280, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final state = designState()..screen = 'map';
      await tester.pumpWidget(ComLabApp(state: state));
      final first = find.ancestor(
        of: find.text('PC-01'),
        matching: find.byType(PcCard),
      );
      final occupied = find.ancestor(
        of: find.text('PC-04'),
        matching: find.byType(PcCard),
      );
      expect(tester.widget<PcCard>(occupied).onTap, isNull);
      await tester.tap(first);
      await tester.pumpAndSettle();
      expect(find.text('Selected'), findsOneWidget);
      expect(find.text('Confirm PC-01'), findsOneWidget);
      state.cloudFresh = false;
      state.navigate('map');
      await tester.pumpAndSettle();
      final confirm = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Confirm selection'),
      );
      expect(confirm.onPressed, isNull);
      expect(tester.widget<PcCard>(first).onTap, isNull);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    },
  );

  testWidgets('tablet design previews render without layout errors', (
    tester,
  ) async {
    // Use local SDK fonts for review images when running on this workstation.
    // Other environments retain the standard Flutter test fonts.
    await tester.runAsync(() async {
      const root =
          'C:/src/flutter/bin/cache/dart-sdk/bin/resources/devtools/assets';
      final regular = File('$root/fonts/Roboto/Roboto-Regular.ttf');
      if (regular.existsSync()) {
        final fonts = FontLoader('Roboto');
        for (final weight in ['Regular', 'Medium', 'Bold', 'Black']) {
          fonts.addFont(
            Future.value(
              ByteData.sublistView(
                File('$root/fonts/Roboto/Roboto-$weight.ttf').readAsBytesSync(),
              ),
            ),
          );
        }
        await fonts.load();
        final icons = FontLoader('MaterialIcons')
          ..addFont(
            Future.value(
              ByteData.sublistView(
                File('$root/fonts/MaterialIcons-Regular.otf').readAsBytesSync(),
              ),
            ),
          );
        await icons.load();
      }
    });
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final state = designState();
    const boundaryKey = ValueKey('preview');
    for (final screen in ['welcome', 'map']) {
      state.screen = screen;
      for (final size in [
        const Size(1024, 600),
        const Size(1280, 800),
        const Size(800, 1280),
      ]) {
        tester.view.physicalSize = size;
        await tester.pumpWidget(
          RepaintBoundary(
            key: boundaryKey,
            child: ComLabApp(state: state),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final boundary = tester.renderObject<RenderRepaintBoundary>(
          find.byKey(boundaryKey),
        );
        await tester.runAsync(() async {
          final picture = await boundary.toImage();
          final data = await picture.toByteData(format: ui.ImageByteFormat.png);
          final file = File('server/.local/$screen-${size.width.toInt()}.png');
          file.parent.createSync(recursive: true);
          file.writeAsBytesSync(data!.buffer.asUint8List());
          picture.dispose();
        });
      }
    }
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });
}
