import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kiosk/data/services.dart';

void main() {
  testWidgets('cloud read can finish after the former 20-second deadline', (
    tester,
  ) async {
    final response = Completer<http.Response>();
    var requests = 0;
    final client = MockClient((request) {
      requests++;
      return response.future;
    });
    final repository = CloudRepository(
      'https://api.example',
      () async => 'unit-token',
      client: client,
    );
    final result = repository.get('/settings');
    await tester.pump();
    await tester.pump(const Duration(seconds: 60));
    response.complete(http.Response('{"welcomeTimeoutSeconds":25}', 200));
    await tester.pump();
    expect(await result, {'welcomeTimeoutSeconds': 25});
    expect(requests, 1);
    client.close();
  });

  for (final lookup in [true, false]) {
    testWidgets(
      lookup
          ? 'lookup timeout offers retry without claiming an unknown reservation'
          : 'reservation timeout preserves uncertainty and never sends a duplicate',
      (tester) async {
        final response = Completer<http.Response>();
        var requests = 0;
        final client = MockClient((request) {
          requests++;
          return response.future;
        });
        final repository = CloudRepository(
          'https://api.example',
          () async => 'unit-token',
          client: client,
        );
        final result = expectLater(
          repository.post(lookup ? '/lookup' : '/reserve', {}),
          throwsA(
            isA<ApiFailure>()
                .having(
                  (error) => error.message,
                  'message',
                  contains(
                    lookup ? 'try again' : 'reconcile the saved operation',
                  ),
                )
                .having(
                  (error) => error.message.contains('result may be unknown'),
                  'reservation uncertainty',
                  !lookup,
                ),
          ),
        );
        await tester.pump();
        await tester.pump(const Duration(seconds: 91));
        await result;
        expect(requests, 1);
        response.complete(http.Response('{}', 200));
        await tester.pump();
        client.close();
      },
    );
  }

  test(
    'redirect diagnostic hides URL secrets and never follows redirect',
    () async {
      var requests = 0;
      final client = MockClient((request) async {
        requests++;
        expect(request.followRedirects, isFalse);
        return http.Response(
          '',
          302,
          headers: {
            'location':
                'https://private-user:private-password@portal.example/login?token=private-token',
          },
        );
      });
      final repository = CloudRepository(
        'https://api.example',
        () async => 'private-bearer',
        client: client,
      );
      try {
        await repository.get('/me');
        fail('Redirect must be rejected');
      } on ApiFailure catch (error) {
        expect(error.status, 302);
        expect(
          error.message,
          contains('https://api.example redirected to https://portal.example'),
        );
        expect(error.message, isNot(contains('private-')));
        expect(error.message, isNot(contains('/login')));
      }
      expect(requests, 1);
      client.close();
    },
  );
}
