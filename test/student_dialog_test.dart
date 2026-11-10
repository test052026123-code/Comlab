import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk/core/contracts.dart';
import 'package:kiosk/core/lab_state.dart';
import 'package:kiosk/ui/app.dart';
import 'package:kiosk/ui/student_editor.dart';
import 'widget_test.dart' show MemoryStore;

class StudentRepository implements LabRepository {
  final students = <Json>[];
  @override
  Future<Json> get(String path) async => path == '/workstations'
      ? {'workstations': <Json>[]}
      : {'rows': path == '/admin/students' ? students : <Json>[]};
  @override
  Future<Json> post(String path, Json data) async {
    expect(path, '/admin/students');
    students.add(Map<String, dynamic>.from(data));
    return {};
  }

  @override
  Future<Json> put(String path, Json data) async => {};
  @override
  Future<String> exportCsv(String query) async => '';
}

void main() {
  testWidgets(
    'generated student IDs can be saved and editing keeps IDs fixed',
    (tester) async {
      tester.view.physicalSize = const Size(1280, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final repo = StudentRepository();
      final state = LabState(store: MemoryStore(), repositoryOverride: repo)
        ..ready = true
        ..admin = true
        ..screen = 'admin';
      await tester.pumpWidget(ComLabApp(state: state));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Students'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add student'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Generate ID'));
      final input = tester.widget<TextField>(
        find.widgetWithText(TextField, 'Unique student ID'),
      );
      final generated = input.controller!.text;
      expect(generated, matches(RegExp(r'^STU-[A-F0-9]{32}$')));
      await tester.enterText(
        find.widgetWithText(TextField, 'Full name'),
        'Generated Student',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Section'),
        'Section A',
      );
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(repo.students.single['id'], generated);
      await tester.pumpWidget(
        MaterialApp(home: StudentEditorDialog(student: repo.students.single)),
      );
      await tester.pumpAndSettle();
      expect(find.text('Generate ID'), findsNothing);
      expect(
        tester
            .widget<TextField>(
              find.widgetWithText(TextField, 'Unique student ID'),
            )
            .enabled,
        false,
      );
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    },
  );

  testWidgets(
    'landscape tablet keyboard leaves the focused field and actions visible',
    (tester) async {
      tester.view.physicalSize = const Size(1280, 800);
      tester.view.devicePixelRatio = 1.5;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () => showDialog<void>(
                  context: context,
                  builder: (_) => const StudentEditorDialog(),
                ),
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      final name = find.widgetWithText(TextField, 'Full name');
      await tester.enterText(name, 'Visible while typing');
      tester.view.viewInsets = const FakeViewPadding(bottom: 390);
      await tester.pumpAndSettle();
      final keyboardTop = (800 - 390) / 1.5;
      final field = tester.getRect(name);
      expect(field.top, greaterThanOrEqualTo(0));
      expect(field.bottom, lessThanOrEqualTo(keyboardTop));
      expect(tester.getRect(find.text('Save')).bottom, lessThan(keyboardTop));
      expect(tester.getRect(find.text('Cancel')).bottom, lessThan(keyboardTop));
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
    },
  );

  for (final save in [true, false]) {
    testWidgets(
      'student dialog closes safely with focused keyboard: save=$save',
      (tester) async {
        tester.view.physicalSize = const Size(1280, 1000);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final repo = StudentRepository();
        final state = LabState(store: MemoryStore(), repositoryOverride: repo)
          ..ready = true
          ..admin = true
          ..screen = 'admin';
        await tester.pumpWidget(ComLabApp(state: state));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Students'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Add student'));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.widgetWithText(TextField, 'Unique student ID'),
          'test-01',
        );
        await tester.enterText(
          find.widgetWithText(TextField, 'Full name'),
          'Test Student',
        );
        await tester.enterText(
          find.widgetWithText(TextField, 'Section'),
          'Test Section',
        );
        await tester.tap(find.text(save ? 'Save' : 'Cancel'));
        // Rebuild while the closing route still contains its text fields.
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 50));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(state.error, isNull);
        expect(
          repo.students,
          save
              ? [
                  {
                    'id': 'TEST-01',
                    'name': 'Test Student',
                    'section': 'Test Section',
                    'active': true,
                    'fingerprintSlot': null,
                  },
                ]
              : isEmpty,
        );
        if (save) expect(find.text('Test Student'), findsOneWidget);
        await tester.pumpWidget(const SizedBox());
        state.dispose();
      },
    );
  }
}
