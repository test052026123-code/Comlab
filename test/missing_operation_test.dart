import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk/core/contracts.dart';
import 'package:kiosk/core/lab_state.dart';
import 'package:kiosk/data/services.dart';
import 'widget_test.dart' show MemoryStore;

class MissingOperationRepository implements LabRepository {
  final gets = <String>[];
  final posts = <String>[];
  @override
  Future<Json> get(String path) async {
    gets.add(path);
    throw ApiFailure('Operation not found.', 404);
  }

  @override
  Future<Json> post(String path, Json data) async {
    posts.add(path);
    return {};
  }

  @override
  Future<Json> put(String path, Json data) async => {};
  @override
  Future<String> exportCsv(String query) async => '';
}

void main() {
  testWidgets(
    'missing session stops automatic recovery and retains the saved operation',
    (tester) async {
      final store = MemoryStore()..values['pending'] = 'saved';
      final repo = MissingOperationRepository();
      final state = LabState(store: store, repositoryOverride: repo)
        ..pending = {'operationId': 'missing-op'}
        ..operation = {
          'session': {'id': 'missing-op'},
        }
        ..session = {'id': 'missing-op', 'status': 'active'};
      await state.run(state.recover);
      expect(state.pending, {'operationId': 'missing-op'});
      expect(store.values['pending'], 'saved');
      expect(state.operation, isNull);
      expect(state.session, isNull);
      expect(state.error, contains('Report a problem'));
      await tester.pump(const Duration(seconds: 10));
      expect(repo.gets, ['/operations/missing-op']);
      expect(repo.posts, isEmpty);
      await state.run(state.recover);
      expect(repo.gets.length, 2);
      state.dispose();
    },
  );
}
