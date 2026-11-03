import 'dart:async';
import 'dart:convert';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import '../data/services.dart';
import 'contracts.dart';

class LabState extends ChangeNotifier {
  LabState({PrivateStore? store, this.repositoryOverride, this.devicesOverride})
    : store = store ?? SecureStore();
  final LabRepository? repositoryOverride;
  final DeviceGateway? devicesOverride;
  final PrivateStore store;
  final Identification identification = StudentIdIdentification();
  FirebaseAuth? kioskAuth, adminAuth;
  bool ready = false, busy = false, admin = false, cloudFresh = false;
  String? error, setupError;
  static const trustedApiUrl = 'https://comlab-api.onrender.com';
  String get apiUrl => trustedApiUrl;
  String controllerUrl = '', pairingToken = '';
  int timeoutMs = 4000, welcomeSeconds = 25;
  String screen = 'welcome';
  Json? student, session, operation, pending;
  List<Json> pcs = [];
  Timer? _welcome, _poll;
  LabRepository get repository =>
      repositoryOverride ??
      CloudRepository(
        apiUrl,
        () async => (admin ? adminAuth : kioskAuth)?.currentUser?.getIdToken(),
      );
  DeviceGateway get devices =>
      devicesOverride ??
      HttpController(
        controllerUrl,
        pairingToken,
        Duration(milliseconds: timeoutMs),
      );
  bool get kioskSignedIn => kioskAuth?.currentUser != null;
  String? acknowledgment;

  Future<void> initialize() async {
    try {
      final saved = await store.read('settings');
      if (saved != null) {
        final data = jsonDecode(saved) as Json;
        // Ignore legacy saved origins, including expired development tunnels.
        controllerUrl = data['controllerUrl'] as String;
        timeoutMs = data['timeoutMs'] as int;
      }
      pairingToken = await store.read('pairing') ?? '';
      final savedPending = await store.read('pending');
      if (savedPending != null) pending = jsonDecode(savedPending) as Json;
      const project = String.fromEnvironment('FIREBASE_PROJECT_ID');
      const appId = String.fromEnvironment('FIREBASE_APP_ID');
      const apiKey = String.fromEnvironment('FIREBASE_API_KEY');
      const sender = String.fromEnvironment('FIREBASE_MESSAGING_SENDER_ID');
      if ([project, appId, apiKey, sender].any((v) => v.isEmpty)) {
        throw ApiFailure(
          'Firebase setup required. Register Android package com.comlab.kiosk, run FlutterFire configuration, then build with the four FIREBASE_* values described in README.md. No project credentials are bundled.',
        );
      }
      const options = FirebaseOptions(
        apiKey: apiKey,
        appId: appId,
        messagingSenderId: sender,
        projectId: project,
      );
      final primary = await Firebase.initializeApp(options: options);
      final secondary = await Firebase.initializeApp(
        name: 'comlab-admin',
        options: options,
      );
      kioskAuth = FirebaseAuth.instanceFor(app: primary);
      adminAuth = FirebaseAuth.instanceFor(app: secondary);
      // Never restore an administrator session into student mode after process death.
      await adminAuth!.signOut();
    } catch (e) {
      setupError = '$e';
    }
    ready = true;
    screen = setupError != null || !kioskSignedIn ? 'setup' : 'welcome';
    notifyListeners();
    if (screen == 'welcome' && pending != null) await run(recover);
  }

  Future<void> run(Future<void> Function() action) async {
    if (busy) return;
    busy = true;
    error = null;
    notifyListeners();
    try {
      await action();
    } catch (e) {
      error = e is FirebaseAuthException
          ? e.message ?? 'Authentication failed.'
          : '$e';
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  void dismissError() {
    error = null;
    notifyListeners();
  }

  void navigate(String destination) {
    _welcome?.cancel();
    _poll?.cancel();
    screen = destination;
    error = null;
    notifyListeners();
  }

  Future<void> configure(String controller, String token, int timeout) async {
    if (controller.isNotEmpty) {
      HttpController(
        controller,
        token.isEmpty ? pairingToken : token,
        Duration(milliseconds: timeout),
      ).endpoint('/health');
    }
    if (admin) {
      final target = CloudRepository(
        apiUrl,
        () async => adminAuth?.currentUser?.getIdToken(),
      );
      await target.post('/admin/connection-settings', {
        'apiUrl': apiUrl,
        'controllerUrl': controller,
        'timeoutMs': timeout,
        'pairingChanged': token.isNotEmpty,
      });
    }
    controllerUrl = controller.replaceFirst(RegExp(r'/$'), '');
    timeoutMs = timeout;
    if (token.isNotEmpty) {
      pairingToken = token;
      await store.write('pairing', token);
    }
    await store.write(
      'settings',
      jsonEncode({
        'apiUrl': apiUrl,
        'controllerUrl': controllerUrl,
        'timeoutMs': timeoutMs,
      }),
    );
  }

  Future<void> login(
    String email,
    String password, {
    required bool asAdmin,
  }) async {
    if (setupError != null) throw ApiFailure(setupError!);
    final auth = asAdmin ? adminAuth! : kioskAuth!;
    try {
      await auth.signInWithEmailAndPassword(
        email: email.trim(),
        password: password,
      );
      final check = CloudRepository(
        apiUrl,
        () async => auth.currentUser?.getIdToken(),
      );
      final me = await check.get('/me');
      if (me['role'] != (asAdmin ? 'admin' : 'kiosk')) {
        throw ApiFailure(
          'Use an explicitly approved ${asAdmin ? 'administrator' : 'kiosk'} account.',
        );
      }
      if (asAdmin) {
        admin = true;
        screen = 'admin';
      } else {
        screen = 'welcome';
        await recover();
      }
    } catch (_) {
      await auth.signOut();
      rethrow;
    }
  }

  Future<void> leaveAdmin() async {
    await adminAuth?.signOut();
    admin = false;
    student = null;
    session = null;
    operation = null;
    acknowledgment = null;
    screen = kioskSignedIn ? 'welcome' : 'setup';
    error = null;
    notifyListeners();
  }

  void resetStudent() {
    _welcome?.cancel();
    _poll?.cancel();
    student = null;
    session = null;
    operation = null;
    acknowledgment = null;
    screen = admin ? 'admin' : 'welcome';
    error = null;
    notifyListeners();
  }

  void scheduleReset() {
    _welcome?.cancel();
    _welcome = Timer(Duration(seconds: welcomeSeconds), _resetWhenIdle);
  }

  void _resetWhenIdle() {
    if (busy) {
      _welcome = Timer(const Duration(seconds: 1), _resetWhenIdle);
    } else {
      resetStudent();
    }
  }

  void _startPolling() {
    if (_poll?.isActive == true) return;
    _poll = Timer.periodic(const Duration(seconds: 3), (_) {
      if (!busy && screen == 'progress' && pending != null) {
        unawaited(run(recover));
      }
    });
  }

  Future<void> lookup(String input) async {
    if (pending != null) {
      throw ApiFailure(
        'A saved operation needs reconciliation before another check-in. Use Recover pending operation.',
      );
    }
    final id = identification.normalize(input);
    final result = await repository.post('/lookup', {'studentId': id});
    student = result['student'] as Json;
    session = result['session'] as Json?;
    final settings = await repository.get('/settings');
    welcomeSeconds = (settings['welcomeTimeoutSeconds'] as num).toInt();
    screen = session == null ? 'confirm' : 'session';
    scheduleReset();
  }

  Future<void> refreshPcs() async {
    cloudFresh = false;
    try {
      final result = await repository.get('/workstations');
      pcs = (result['workstations'] as List).cast<Json>();
      cloudFresh = true;
      if (result['controllerError'] != null) {
        error = result['controllerError'] as String;
      }
    } finally {
      notifyListeners();
    }
  }

  Future<void> showMap() async {
    await refreshPcs();
    screen = 'map';
    scheduleReset();
  }

  Future<void> reserve(String pc) async {
    _welcome?.cancel();
    if (pending != null) {
      throw ApiFailure('Reconcile the saved operation first.');
    }
    final request = {
      'operationId': const Uuid().v4(),
      'studentId': student!['id'],
      'workstationId': pc,
    };
    pending = request;
    await store.write('pending', jsonEncode(request));
    screen = 'progress';
    notifyListeners();
    try {
      operation = await repository.post('/reserve', request);
    } on ApiFailure catch (e) {
      if ([400, 403, 404, 409].contains(e.status)) {
        await clearPending();
        screen = 'map';
      }
      rethrow;
    }
    session = operation!['session'] as Json;
    notifyListeners();
    await dispatchNewCommand();
  }

  Future<void> dispatchNewCommand() async {
    final command = operation?['command'] as Json?;
    if (command == null) {
      await clearPending();
      screen = 'session';
      scheduleReset();
      return;
    }
    if (command['delivery'] == 'cloud') {
      // Reservation and the outbound-device queue were committed atomically.
      // Never fall back to a LAN pulse for a cloud-delivered command.
      acknowledgment = command['state'] as String? ?? 'pending';
      await reconcile();
      return;
    }
    // Called only immediately following a confirmed new reservation / reassignment.
    // Recover() never calls this function.
    try {
      final r = await devices.submit(command);
      acknowledgment = r['state'] as String;
    } catch (_) {
      acknowledgment = 'unknown';
      error =
          'Command delivery uncertain. PC remains reserved. Use Reconcile; do not repeat the power pulse.';
    }
    await reconcile();
  }

  Future<void> clearPending() async {
    await store.write('pending', null);
    pending = null;
  }

  Future<void> recover() async {
    if (pending == null) return;
    screen = 'progress';
    _startPolling();
    if (_welcome?.isActive != true) scheduleReset();
    final id = pending!['operationId'];
    try {
      operation = await repository.get('/operations/$id');
      session = operation!['session'] as Json;
      await reconcile();
    } on ApiFailure catch (e) {
      if (e.status == 404) {
        // POST timed out before commit, or was never sent. Read-only recovery.
        error =
            'Reservation is not visible yet. Retry Reconcile after the server request settles. An administrator can clear this saved ID after confirming no commit.';
      } else {
        rethrow;
      }
    }
  }

  Future<void> reconcile() async {
    final id = operation?['session']?['id'] ?? pending?['operationId'];
    if (id == null) return;
    operation = await repository.post('/operations/$id/reconcile', {});
    session = operation!['session'] as Json;
    final cmd = operation!['command'] as Json?;
    if (cmd == null || terminalCommand(cmd['state'] as String?)) {
      await clearPending();
      screen = 'session';
      scheduleReset();
      _poll?.cancel();
    } else {
      screen = 'progress';
      if (_welcome?.isActive != true) scheduleReset();
      _startPolling();
    }
    notifyListeners();
  }

  Future<void> checkout({String? reason}) async {
    await repository.post('/sessions/${session!['id']}/close', {
      'reason': reason,
    });
    await clearPending();
    resetStudent();
  }

  Future<void> report(String description) async {
    await repository.post('/issues', {
      'sessionId': session!['id'],
      'description': description,
    });
    screen = 'session';
    scheduleReset();
  }

  Future<void> reassign(Json source, String pc, String reason) async {
    if (pending != null) {
      throw ApiFailure('Reconcile the existing pending operation first.');
    }
    final id = const Uuid().v4();
    final request = {
      'sessionId': source['id'],
      'operationId': id,
      'workstationId': pc,
      'reason': reason,
    };
    pending = {'operationId': id};
    await store.write('pending', jsonEncode(pending));
    try {
      operation = await repository.post('/admin/reassign', request);
    } on ApiFailure catch (e) {
      if ([400, 403, 404, 409].contains(e.status)) await clearPending();
      rethrow;
    }
    session = operation!['session'] as Json;
    screen = 'progress';
    await dispatchNewCommand();
  }

  @override
  void dispose() {
    _welcome?.cancel();
    _poll?.cancel();
    super.dispose();
  }
}
