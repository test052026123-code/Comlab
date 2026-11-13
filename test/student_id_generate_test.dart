import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk/ui/student_editor.dart';

void main() {
  testWidgets(
    'Generate uses the current year, skips existing IDs, and retains keyboard focus',
    (tester) async {
      tester.view.physicalSize = const Size(1280, 800);
      tester.view.devicePixelRatio = 1.5;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);
      final year = DateTime.now().year;
      final available = 'STU-${year}2123';
      final taken = {
        for (var i = 0; i < 10000; i++)
          if (i != 2123) 'STU-$year${i.toString().padLeft(4, '0')}',
      };
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () => showDialog<void>(
                  context: context,
                  builder: (_) =>
                      StudentEditorDialog(existingStudentIds: taken),
                ),
                child: const Text('Add student'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Add student'));
      await tester.pumpAndSettle();
      final field = find.byType(TextField).first;
      await tester.tap(field);
      await tester.pumpAndSettle();
      final editor = tester.state<EditableTextState>(
        find.byType(EditableText).first,
      );
      tester.view.viewInsets = const FakeViewPadding(bottom: 400);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Generate'));
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(field).controller!.text, available);
      expect(available, matches(RegExp(r'^STU-\d{8}$')));
      expect(
        tester.state<EditableTextState>(find.byType(EditableText).first),
        same(editor),
      );
      expect(editor.widget.focusNode.hasFocus, isTrue);
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('Generate'));
      await tester.pumpAndSettle();
      expect(find.textContaining('All generated IDs'), findsOneWidget);
      expect(tester.widget<TextField>(field).controller!.text, available);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
    },
  );

  testWidgets('editing a student keeps its ID locked and hides Generate', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => showDialog<void>(
                context: context,
                builder: (_) => const StudentEditorDialog(
                  student: {
                    'id': 'STU-20262123',
                    'name': 'Test student',
                    'section': 'A',
                    'active': true,
                  },
                ),
              ),
              child: const Text('Edit student'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Edit student'));
    await tester.pumpAndSettle();
    expect(find.text('Generate'), findsNothing);
    expect(
      tester.widget<TextField>(find.byType(TextField).first).enabled,
      isFalse,
    );
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
  });
}
