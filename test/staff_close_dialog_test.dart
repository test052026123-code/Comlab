import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk/core/contracts.dart';
import 'package:kiosk/core/lab_state.dart';
import 'package:kiosk/data/services.dart';
import 'package:kiosk/ui/app.dart';
import 'widget_test.dart' show MemoryStore;

class StaffSessionRepository implements LabRepository {
  StaffSessionRepository({this.rejectClose = false});
  final bool rejectClose;
  final writes = <Json>[];
  final session = <String, dynamic>{
    'id': 'session-1',
    'studentId': 'STUDENT-1',
    'name': 'bryan',
    'section': '4-b',
    'workstationId': 'PC-01',
    'status': 'active',
    'timeIn': '2026-11-11T02:45:00Z',
    'timeOut': null,
  };
  @override
  Future<Json> get(String path) async {
    if (path == '/workstations') return {'workstations': <Json>[]};
    return {
      'rows': path.startsWith('/admin/history') ? [session] : <Json>[],
    };
  }

  @override
  Future<Json> post(String path, Json data) async {
    expect(path, '/sessions/session-1/close');
    writes.add(Map<String, dynamic>.from(data));
    if (rejectClose) {
      throw ApiFailure('Power delivery is pending or unknown.', 409);
    }
    session['status'] = 'closed';
    return {'closed': true};
  }

  @override
  Future<Json> put(String path, Json data) async => {};
  @override
  Future<String> exportCsv(String query) async => '';
}

void main() {
  for (final scenario in ['close', 'cancel', 'rejected']) {
    testWidgets('focused staff close dialog exits safely: $scenario', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1280, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final repo = StaffSessionRepository(rejectClose: scenario == 'rejected');
      final state = LabState(store: MemoryStore(), repositoryOverride: repo)
        ..ready = true
        ..admin = true
        ..screen = 'admin';
      await tester.pumpWidget(ComLabApp(state: state));
      await tester.pumpAndSettle();
      await tester.tap(find.text('PC-01 • bryan'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Staff close'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextField),
        '  Closed at user request  ',
      );
      expect(tester.testTextInput.isVisible, isTrue);
      await tester.tap(find.text(scenario == 'cancel' ? 'Cancel' : 'Confirm'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.byType(AlertDialog), findsNothing);
      expect(
        repo.writes,
        scenario == 'cancel'
            ? isEmpty
            : [
                {'reason': 'Closed at user request'},
              ],
      );
      expect(repo.session['status'], scenario == 'close' ? 'closed' : 'active');
      expect(
        state.error,
        scenario == 'rejected' ? 'Power delivery is pending or unknown.' : null,
      );
      await tester.pumpWidget(const SizedBox.shrink());
      state.dispose();
    });
  }
}
