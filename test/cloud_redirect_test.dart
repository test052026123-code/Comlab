import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kiosk/data/services.dart';

void main() {
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
