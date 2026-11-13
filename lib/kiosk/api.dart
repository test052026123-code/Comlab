import 'dart:async';
import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

/// Error shown to the student in a modal alert.
class ApiError implements Exception {
  ApiError(this.message, {this.status = 0, this.offline = false});
  final String message;
  final int status;
  final bool offline;
  @override
  String toString() => message;
}

/// Talks to the ComLab server on the Raspberry Pi over the lab Wi-Fi.
class KioskApi {
  KioskApi({http.Client? client, FlutterSecureStorage? storage})
    : _http = client ?? http.Client(),
      _store = storage ?? const FlutterSecureStorage();

  static const defaultServer = 'http://192.168.0.102:8080';
  final http.Client _http;
  final FlutterSecureStorage _store;
  String server = defaultServer;
  String? token;

  bool get paired => token != null;

  Future<void> load() async {
    server = await _store.read(key: 'server') ?? defaultServer;
    token = await _store.read(key: 'kioskToken');
  }

  Future<void> unpair() async {
    token = null;
    await _store.delete(key: 'kioskToken');
  }

  /// One-time setup: an admin signs in and the server issues a kiosk token.
  Future<void> pair(String serverUrl, String username, String password) async {
    server = serverUrl.trim().replaceAll(RegExp(r'/+$'), '');
    final login = await _send('POST', '/auth/login', {'username': username, 'password': password}, auth: false);
    final adminToken = login['token'] as String;
    if (login['user']?['role'] != 'admin') throw ApiError('Only an administrator can set up this tablet.');
    final pairing = await _send('POST', '/kiosks/pair', {'name': 'Lab tablet'}, bearer: adminToken);
    token = pairing['token'] as String;
    await _store.write(key: 'server', value: server);
    await _store.write(key: 'kioskToken', value: token);
    await _send('POST', '/auth/logout', null, bearer: adminToken).catchError((_) => null);
  }

  Future<dynamic> get(String path) => _send('GET', path, null);
  Future<dynamic> post(String path, [Map<String, dynamic>? body]) => _send('POST', path, body ?? {});

  Future<dynamic> _send(String method, String path, Map<String, dynamic>? body, {bool auth = true, String? bearer}) async {
    final headers = {'content-type': 'application/json'};
    final t = bearer ?? (auth ? token : null);
    if (t != null) headers['authorization'] = 'Bearer $t';
    final uri = Uri.parse('$server$path');
    http.Response r;
    try {
      r = await (method == 'GET'
              ? _http.get(uri, headers: headers)
              : _http.post(uri, headers: headers, body: jsonEncode(body ?? {})))
          .timeout(const Duration(seconds: 10));
    } on TimeoutException {
      throw ApiError('The lab server did not respond. Check that the Raspberry Pi is on.', offline: true);
    } catch (_) {
      throw ApiError('Cannot reach the lab server. Check the Wi-Fi connection.', offline: true);
    }
    dynamic data;
    try {
      data = r.body.isEmpty ? null : jsonDecode(r.body);
    } catch (_) {
      data = null;
    }
    if (r.statusCode >= 400) {
      if (r.statusCode == 401 && auth && bearer == null) await unpair();
      final msg = data is Map && data['error'] is String ? data['error'] as String : 'Request failed (${r.statusCode}).';
      throw ApiError(msg, status: r.statusCode);
    }
    return data;
  }
}
