import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk/ui/student_editor.dart';
import 'package:kiosk/ui/workstation_editor.dart';

void main() {
  for (final student in [true, false]) {
    testWidgets(
      '${student ? 'Student' : 'Workstation'} form remains usable above the tablet keyboard',
      (tester) async {
        tester.view.physicalSize = const Size(1280, 800);
        tester.view.devicePixelRatio = 1.5;
        tester.view.padding = const FakeViewPadding(top: 36, bottom: 72);
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        addTearDown(tester.view.resetPadding);
        addTearDown(tester.view.resetViewInsets);
        await tester.pumpWidget(
          MaterialApp(
            theme: ThemeData(
              useMaterial3: true,
              filledButtonTheme: FilledButtonThemeData(
                style: FilledButton.styleFrom(minimumSize: const Size(60, 54)),
              ),
              inputDecorationTheme: const InputDecorationTheme(
                contentPadding: EdgeInsets.all(18),
              ),
            ),
            home: Scaffold(
              body: Builder(
                builder: (context) => TextButton(
                  onPressed: () => showDialog<void>(
                    context: context,
                    builder: (_) => student
                        ? const StudentEditorDialog()
                        : const WorkstationEditorDialog(),
                  ),
                  child: const Text('Open editor'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Open editor'));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byType(TextField).first,
          student ? 'TEST-1' : 'PC-01',
        );
        final editorBefore = tester.state<EditableTextState>(
          find.byType(EditableText).first,
        );
        final focusBefore = editorBefore.widget.focusNode;
        expect(focusBefore.hasFocus, isTrue);
        tester.view.padding = const FakeViewPadding(top: 36);
        tester.view.viewInsets = const FakeViewPadding(bottom: 400);
        await tester.pumpAndSettle();
        expect(
          tester.state<EditableTextState>(find.byType(EditableText).first),
          same(editorBefore),
        );
        expect(focusBefore.hasFocus, isTrue);
        final scroll = find.byType(SingleChildScrollView);
        expect(tester.getSize(scroll).height, greaterThan(100));
        final keyboardTop = (800 - 400) / 1.5;
        for (final label in ['Save', 'Cancel']) {
          expect(find.text(label).hitTestable(), findsOneWidget);
          expect(
            tester.getRect(find.text(label)).bottom,
            lessThan(keyboardTop),
          );
        }
        tester.view.viewInsets = const FakeViewPadding();
        tester.view.padding = const FakeViewPadding(top: 36, bottom: 72);
        await tester.pumpAndSettle();
        expect(
          tester.state<EditableTextState>(find.byType(EditableText).first),
          same(editorBefore),
        );
        expect(focusBefore.hasFocus, isTrue);
        tester.view.viewInsets = const FakeViewPadding(bottom: 400);
        tester.view.padding = const FakeViewPadding(top: 36);
        await tester.pumpAndSettle();
        expect(
          tester.state<EditableTextState>(find.byType(EditableText).first),
          same(editorBefore),
        );
        expect(focusBefore.hasFocus, isTrue);
        expect(
          tester
              .widget<EditableText>(find.byType(EditableText).first)
              .style
              .fontSize,
          greaterThanOrEqualTo(14),
        );
        await tester.drag(scroll, const Offset(0, -400));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.byType(TextField).last);
        await tester.enterText(
          find.byType(TextField).last,
          student ? '1' : 'Notes',
        );
        expect(find.text('Save').hitTestable(), findsOneWidget);
        expect(
          tester
              .widget<TextField>(find.byType(TextField).first)
              .controller!
              .text,
          student ? 'TEST-1' : 'PC-01',
        );
        await tester.tap(find.text('Cancel'));
        await tester.pumpAndSettle();
        expect(find.byType(AlertDialog), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
