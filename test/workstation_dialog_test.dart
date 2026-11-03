import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk/core/contracts.dart';
import 'package:kiosk/core/lab_state.dart';
import 'package:kiosk/data/services.dart';
import 'package:kiosk/ui/app.dart';
import 'widget_test.dart' show MemoryStore;

class WorkstationRepository implements LabRepository {
  final workstations = <Json>[];
  final writes = <Json>[];
  bool failSave = false;
  @override
  Future<Json> get(String path) async => path == '/workstations'
      ? {'workstations': workstations}
      : {'rows': <Json>[]};
  @override
  Future<Json> put(String path, Json data) async {
    expect(path, '/admin/workstations/PC-01');
    if (failSave) throw ApiFailure('Test workstation save failed', 503);
    writes.add(Map<String, dynamic>.from(data));
    workstations
      ..clear()
      ..add({'id': 'PC-01', ...data, 'eligible': false});
    return {};
  }

  @override
  Future<Json> post(String path, Json data) async => {};
  @override
  Future<String> exportCsv(String query) async => '';
}

void main() {
  for (final scenario in ['create', 'cancel', 'edit', 'failure']) {
    testWidgets('focused workstation dialog closes safely: $scenario', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1280, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final repo = WorkstationRepository()..failSave = scenario == 'failure';
      if (scenario == 'edit') {
        repo.workstations.add({
          'id': 'PC-01',
          'nodeId': 'NODE-01',
          'enabled': true,
          'maintenance': false,
          'notes': 'Original notes',
          'eligible': false,
        });
      }
      final state = LabState(store: MemoryStore(), repositoryOverride: repo)
        ..ready = true
        ..admin = true
        ..screen = 'admin';
      await tester.pumpWidget(ComLabApp(state: state));
      await tester.pumpAndSettle();
      await tester.tap(
        find.descendant(
          of: find.byType(NavigationRail),
          matching: find.text('Workstations'),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.text(scenario == 'edit' ? 'PC-01' : 'Create workstation'),
      );
      await tester.pumpAndSettle();
      final fields = find.descendant(
        of: find.byType(AlertDialog),
        matching: find.byType(TextField),
      );
      if (scenario != 'edit') {
        await tester.enterText(fields.at(0), ' pc-01 ');
        await tester.enterText(fields.at(1), ' node-01 ');
      } else {
        expect(tester.widget<TextField>(fields.at(0)).enabled, isFalse);
        await tester.tap(find.text('Maintenance restriction'));
        await tester.pump();
      }
      await tester.enterText(fields.at(2), 'Updated notes');
      expect(tester.testTextInput.isVisible, isTrue);
      await tester.tap(find.text(scenario == 'cancel' ? 'Cancel' : 'Save'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.byType(AlertDialog), findsNothing);
      if (scenario == 'failure') {
        expect(state.error, 'Test workstation save failed');
        expect(repo.writes, isEmpty);
      } else if (scenario == 'cancel') {
        expect(state.error, isNull);
        expect(repo.writes, isEmpty);
      } else {
        expect(state.error, isNull);
        expect(repo.writes, [
          {
            'nodeId': 'NODE-01',
            'notes': 'Updated notes',
            'enabled': true,
            'maintenance': scenario == 'edit',
          },
        ]);
        expect(find.text('PC-01'), findsOneWidget);
      }
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    });
  }
}
