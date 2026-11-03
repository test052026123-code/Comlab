import 'dart:async';
import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import '../core/contracts.dart';

Future<http.Response> _send(http.Client client, http.Request request) async =>
    http.Response.fromStream(await client.send(request));

class SecureStore implements PrivateStore {
  final FlutterSecureStorage storage = const FlutterSecureStorage();
  @override
  Future<String?> read(String key) => storage.read(key: key);
  @override
  Future<void> write(String key, String? value) => value == null
      ? storage.delete(key: key)
      : storage.write(key: key, value: value);
}

class ApiFailure implements Exception {
  final String message;
  final int? status;
  ApiFailure(this.message, [this.status]);
  @override
  String toString() => message;
}

class CloudRepository implements LabRepository {
  static final http.Client sharedClient = http.Client();
  final String base;
  final Future<String?> Function() token;
  final http.Client client;
  CloudRepository(this.base, this.token, {http.Client? client})
    : client = client ?? sharedClient;
  Future<http.Response> request(
    String method,
    String path, [
    Json? data,
  ]) async {
    final uri = Uri.parse('$base$path');
    if (uri.scheme != 'https' || !uri.hasAuthority || uri.userInfo.isNotEmpty) {
      throw ApiFailure('A valid HTTPS trusted API origin is required.');
    }
    final auth = await token();
    if (auth == null) {
      throw ApiFailure(
        'Sign in with an approved kiosk or administrator account.',
      );
    }
    final req = http.Request(method, uri)
      ..followRedirects = false
      ..headers.addAll({
        'Authorization': 'Bearer $auth',
        'Content-Type': 'application/json',
      });
    if (data != null) req.body = jsonEncode(data);
    try {
      final r = await _send(client, req).timeout(const Duration(seconds: 20));
      if (r.statusCode >= 300 && r.statusCode < 400) {
        final location = r.headers['location'];
        final destination = location == null ? null : Uri.tryParse(location);
        final resolved = destination == null
            ? null
            : uri.resolveUri(destination);
        // Show only origins; redirect URLs may contain credentials or tokens.
        final target =
            resolved != null &&
                ['https', 'http'].contains(resolved.scheme) &&
                resolved.host.isNotEmpty
            ? Uri(
                scheme: resolved.scheme,
                host: resolved.host,
                port: resolved.hasPort ? resolved.port : null,
              ).origin
            : 'an unspecified destination';
        throw ApiFailure(
          'Cloud HTTP ${r.statusCode}: ${uri.origin} redirected to $target. '
          'Request stopped. Check the cloud service and tablet network. '
          'Credentials were not forwarded.',
          r.statusCode,
        );
      }
      if (r.statusCode >= 300) {
        String message =
            'Cloud HTTP ${r.statusCode}. Check API availability and account approval.';
        try {
          message = jsonDecode(r.body)['error'] as String? ?? message;
        } catch (_) {
          /* reverse proxy may return HTML */
        }
        throw ApiFailure(message, r.statusCode);
      }
      return r;
    } on TimeoutException {
      throw ApiFailure(
        'Cloud request timed out. The result may be unknown; reconcile the saved operation.',
      );
    } on http.ClientException {
      throw ApiFailure(
        'Trusted API unreachable. Check Wi-Fi, HTTPS certificate and internet.',
      );
    }
  }

  @override
  Future<Json> get(String path) async =>
      jsonDecode((await request('GET', path)).body) as Json;
  @override
  Future<Json> post(String path, Json data) async =>
      jsonDecode((await request('POST', path, data)).body) as Json;
  @override
  Future<Json> put(String path, Json data) async =>
      jsonDecode((await request('PUT', path, data)).body) as Json;
  @override
  Future<String> exportCsv(String query) async =>
      (await request('GET', '/admin/history.csv$query')).body;
}

class HttpController implements DeviceGateway {
  static final http.Client sharedClient = http.Client();
  final String base, pairingToken;
  final Duration timeout;
  final http.Client client;
  HttpController(
    this.base,
    this.pairingToken,
    this.timeout, {
    http.Client? client,
  }) : client = client ?? sharedClient;
  Uri endpoint(String path) {
    final uri = Uri.parse('$base/v1$path');
    // Cleartext is confined to the documented prototype host, including in Android XML.
    if ((!['https', 'http'].contains(uri.scheme)) ||
        !uri.hasAuthority ||
        uri.hasQuery ||
        uri.hasFragment ||
        uri.userInfo.isNotEmpty ||
        (uri.scheme == 'http' && uri.host != 'comlab-controller.local')) {
      throw ApiFailure(
        'Use HTTPS for the controller, or http://comlab-controller.local for the isolated prototype.',
      );
    }
    if (pairingToken.isEmpty) {
      throw ApiFailure('Administrator must pair the controller in Settings.');
    }
    return uri;
  }

  Future<Json> call(String method, String path, [Json? body]) async {
    final request = http.Request(method, endpoint(path))
      ..followRedirects = false
      ..headers.addAll({
        'Authorization': 'Bearer $pairingToken',
        'Content-Type': 'application/json',
      });
    if (body != null) request.body = jsonEncode(body);
    final response = await _send(client, request).timeout(timeout);
    if (response.statusCode >= 300) {
      throw ApiFailure(
        'Controller HTTP ${response.statusCode}. Check pairing and controller diagnostics.',
        response.statusCode,
      );
    }
    return jsonDecode(response.body) as Json;
  }

  @override
  Future<Json> health() => call('GET', '/health');
  @override
  Future<Json> nodes() => call('GET', '/nodes');
  @override
  Future<Json> result(String commandId) => call('GET', '/commands/$commandId');
  @override
  Future<Json> submit(Json command) async {
    final payload = {
      for (final k in ['commandId', 'workstationId', 'nodeId', 'action'])
        k: command[k],
    };
    // Only one bounded retry, same payload / command ID. Never invoked by startup reconciliation.
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        final result = await call('POST', '/commands', payload);
        if (result['commandId'] != command['commandId'] ||
            ![
              'accepted',
              'pending',
              'confirmed_on',
              'rejected',
              'failed',
            ].contains(result['state'])) {
          throw ApiFailure(
            'Controller acknowledgment is invalid. Keep reservation pending and reconcile.',
          );
        }
        return result;
      } on ApiFailure {
        rethrow;
      } on TimeoutException {
        if (attempt == 1) rethrow;
      } on http.ClientException {
        if (attempt == 1) rethrow;
      }
    }
    throw ApiFailure(
      'Command delivery unknown. Reconcile before releasing the PC.',
    );
  }
}
