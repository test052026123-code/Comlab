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
  // Record IDs remain available only in administrator student management.
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
  List<Json> savedCheckIns = [];
  String? selectionConfirmation;
  List<Json> pcs = [];
  Timer? _welcome, _poll;
  Timer? _scanPoll;
  Timer? _scanDeadline;
  Timer? _pcPoll;
  Future<void>? _pcRefresh;
  bool _disposed = false;
  String? scanRequestId;
  bool fingerprintScanning = false;
  int _scanGeneration = 0;
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
  String? reportConfirmation;
  String? sessionEndConfirmation;
  bool get hasSavedReservation => pending?['reservationConfirmed'] == true;
  bool get startupUnverified =>
      session?['status'] == 'active' &&
      operation?['command']?['state'] == 'unknown';

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
      await loadSavedCheckIns();
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
    if ((destination != 'welcome' && fingerprintScanning) ||
        ['setup', 'login', 'admin'].contains(destination)) {
      stopFingerprintScan();
    }
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

  static void validateSignInCredentials(String email, String password) {
    if (email.trim().isEmpty) throw ApiFailure('Enter your account email.');
    if (password.isEmpty) throw ApiFailure('Enter your password.');
  }

  Future<void> login(
    String email,
    String password, {
    required bool asAdmin,
  }) async {
    if (setupError != null) throw ApiFailure(setupError!);
    validateSignInCredentials(email, password);
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
    stopFingerprintScan();
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
    stopFingerprintScan();
    _welcome?.cancel();
    _poll?.cancel();
    student = null;
    session = null;
    operation = null;
    acknowledgment = null;
    reportConfirmation = null;
    screen = admin ? 'admin' : 'welcome';
    error = null;
    notifyListeners();
  }

  void scheduleReset() {
    _welcome?.cancel();
    final seconds = screen == 'map' && welcomeSeconds < 60
        ? 60
        : welcomeSeconds;
    _welcome = Timer(Duration(seconds: seconds), _resetWhenIdle);
  }

  void recordStudentActivity() {
    if (!admin &&
        student != null &&
        ['confirm', 'map', 'progress', 'session', 'issue'].contains(screen)) {
      scheduleReset();
    }
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

  void stopFingerprintScan() {
    _scanGeneration++;
    _scanPoll?.cancel();
    _scanDeadline?.cancel();
    final id = scanRequestId;
    scanRequestId = null;
    if (fingerprintScanning && id != null) {
      unawaited(
        repository
            .post('/fingerprint/requests/$id/cancel', {})
            .catchError((_) => <String, dynamic>{}),
      );
    }
    fingerprintScanning = false;
  }

  Future<void> startFingerprintScan() async {
    reportConfirmation = null;
    selectionConfirmation = null;
    sessionEndConfirmation = null;
    if (pending != null) {
      await _archivePending();
    }
    stopFingerprintScan();
    final generation = _scanGeneration;
    final id = const Uuid().v4();
    scanRequestId = id;
    fingerprintScanning = true;
    notifyListeners();
    try {
      final result = await repository.post('/fingerprint/requests', {
        'requestId': id,
      });
      if (generation != _scanGeneration) return;
      await _handleFingerprintResult(result, generation);
      if (!fingerprintScanning) return;
      _scanDeadline = Timer(const Duration(seconds: 70), () {
        if (generation != _scanGeneration || !fingerprintScanning) return;
        stopFingerprintScan();
        error =
            'Scan timed out. Check the controller connection and try again.';
        notifyListeners();
      });
      _scanPoll = Timer.periodic(const Duration(seconds: 2), (_) {
        if (!busy && fingerprintScanning) {
          unawaited(
            run(() async {
              Json result;
              try {
                result = await repository.get('/fingerprint/requests/$id');
              } on ApiFailure catch (e) {
                // Re-read the SAME request after a transient transport failure.
                // Never create a second scan or retry a terminal scan result.
                if (e.retryable) return;
                if (generation == _scanGeneration) stopFingerprintScan();
                rethrow;
              } catch (_) {
                if (generation == _scanGeneration) stopFingerprintScan();
                rethrow;
              }
              if (generation == _scanGeneration) {
                await _handleFingerprintResult(result, generation);
              }
            }),
          );
        }
      });
    } catch (_) {
      if (generation == _scanGeneration) stopFingerprintScan();
      rethrow;
    }
  }

  Future<void> _handleFingerprintResult(Json result, int generation) async {
    if (result['state'] == 'waiting') return;
    _scanPoll?.cancel();
    _scanDeadline?.cancel();
    fingerprintScanning = false;
    if (result['state'] != 'matched') {
      scanRequestId = null;
      throw ApiFailure(switch (result['state']) {
        'no_match' =>
          'Fingerprint not recognized. Try again or ask staff to enroll you.',
        'unlinked' =>
          'This fingerprint is not linked to a student. Ask an administrator.',
        'expired' =>
          'Scan timed out. Check the controller connection and try again.',
        'canceled' => 'Scan canceled. Tap Scan fingerprint to try again.',
        _ => 'The scanner could not read your finger. Lift it and try again.',
      });
    }
    final settings = await repository.get('/settings');
    if (generation != _scanGeneration) return;
    student = result['student'] as Json;
    session = result['session'] as Json?;
    welcomeSeconds = (settings['welcomeTimeoutSeconds'] as num).toInt();
    operation = null;
    if (session == null) {
      for (final saved in [...savedCheckIns].reversed) {
        if (saved['studentId'] != student!['id']) continue;
        try {
          final prior = await repository.get(
            '/operations/${saved['operationId']}',
          );
          if (generation != _scanGeneration) return;
          final priorSession = prior['session'] as Json;
          if (priorSession['status'] == 'closed') {
            await _forgetSavedCheckIn(saved['operationId'] as String);
            continue;
          }
          if (priorSession['id'] != saved['operationId'] ||
              priorSession['studentId'] != student!['id']) {
            throw ApiFailure('Ask staff to check your previous selection.');
          }
          session = priorSession;
          operation = prior;
          break;
        } on ApiFailure catch (e) {
          // Staff removed this session on the server; nothing is held, so
          // the student may check in again.
          if (e.status == 404) {
            await _forgetSavedCheckIn(saved['operationId'] as String);
            continue;
          }
          throw ApiFailure(
            'Your previous selection could not be checked. Please ask staff before choosing another computer.',
          );
        }
      }
    }
    screen = session == null ? 'confirm' : 'session';
    scheduleReset();
  }

  void startPcStatusPolling() {
    _pcPoll?.cancel();
    _pcPoll = Timer.periodic(const Duration(seconds: 5), (_) {
      if (_disposed || screen != 'map') {
        _pcPoll?.cancel();
        return;
      }
      if (!busy) {
        // Read-only refresh does not count as student activity or start a session.
        unawaited(refreshPcs().catchError((Object _) {}));
      }
    });
  }

  void stopPcStatusPolling() => _pcPoll?.cancel();

  Future<void> refreshPcs() =>
      _pcRefresh ??= _loadPcs().whenComplete(() => _pcRefresh = null);

  Future<void> _loadPcs() async {
    try {
      final result = await repository.get('/workstations');
      pcs = (result['workstations'] as List).cast<Json>();
      cloudFresh = true;
      if (result['controllerError'] != null) {
        error = result['controllerError'] as String;
      }
    } catch (_) {
      cloudFresh = false;
      rethrow;
    } finally {
      if (!_disposed) notifyListeners();
    }
  }

  Future<void> showMap() async {
    await refreshPcs();
    screen = 'map';
    scheduleReset();
  }

  Future<void> loadSavedCheckIns() async {
    final saved = await store.read('savedCheckIns');
    if (saved != null) savedCheckIns = (jsonDecode(saved) as List).cast<Json>();
    final old = await store.read('pending');
    if (old != null) pending = jsonDecode(old) as Json;
    if (pending != null) await _archivePending();
  }

  Future<void> _archivePending({bool confirmed = false}) async {
    if (pending == null) return;
    final record = {
      ...pending!,
      'reservationConfirmed': confirmed || hasSavedReservation,
    };
    savedCheckIns = [
      ...savedCheckIns.where((r) => r['operationId'] != record['operationId']),
      record,
    ];
    // Persist identity before releasing the kiosk for the next student.
    await store.write('savedCheckIns', jsonEncode(savedCheckIns));
    await clearPending();
  }

  Future<void> _forgetSavedCheckIn(String id) async {
    savedCheckIns = savedCheckIns.where((r) => r['operationId'] != id).toList();
    await store.write(
      'savedCheckIns',
      savedCheckIns.isEmpty ? null : jsonEncode(savedCheckIns),
    );
  }

  Future<void> confirmPcSelection(String pc) async {
    if (student == null || pending != null) {
      throw ApiFailure('Scan your fingerprint before choosing a computer.');
    }
    _welcome?.cancel();
    cloudFresh = false;
    selectionConfirmation = null;
    final request = <String, dynamic>{
      'operationId': const Uuid().v4(),
      'studentId': student!['id'],
      'workstationId': pc,
      if (scanRequestId != null) 'scanRequestId': scanRequestId,
    };
    pending = request;
    await store.write('pending', jsonEncode(request));
    try {
      final reply = await repository.post('/reserve', request);
      final reserved = reply['session'] as Json;
      if (reserved['id'] != request['operationId'] ||
          reserved['studentId'] != request['studentId'] ||
          reserved['workstationId'] != pc ||
          reserved['status'] != 'active') {
        throw ApiFailure('The selection could not be verified.');
      }
      final command = reply['command'] as Json?;
      // Cloud reservations already enqueue their one power-on command atomically.
      // Only legacy LAN installations need a single direct submission here.
      if (command != null && command['delivery'] != 'cloud') {
        try {
          await devices.submit(command);
        } catch (_) {
          /* preserve the saved command identity */
        }
      }
      await _archivePending(confirmed: true);
      resetStudent();
      selectionConfirmation =
          '$pc selected. Please go to your computer. When you are done, or if there is a problem, scan again to end your session or report it.';
    } on ApiFailure catch (e) {
      if ([400, 403, 404, 409].contains(e.status)) {
        await clearPending();
      } else {
        await _archivePending();
      }
      resetStudent();
      throw ApiFailure(
        'We could not confirm your selection. Scan again to check your assignment, or ask staff for help.',
        e.status,
      );
    } catch (_) {
      await _archivePending();
      resetStudent();
      throw ApiFailure(
        'We could not confirm your selection. Scan again to check your assignment.',
      );
    }
    notifyListeners();
  }

  Future<void> reserve(String pc) async {
    _welcome?.cancel();
    if (pending != null) {
      throw ApiFailure('Reconcile the saved operation first.');
    }
    cloudFresh = false;
    final request = {
      'operationId': const Uuid().v4(),
      'studentId': student!['id'],
      'workstationId': pc,
      if (scanRequestId != null) 'scanRequestId': scanRequestId,
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
      if (await _restoreUnverifiedSession(id as String)) return;
      await reconcile();
    } on ApiFailure catch (e) {
      if (e.status == 404) {
        // Missing/deleted records require a deliberate recovery action. Keep
        // the saved ID, but stop polling a record the server says is absent.
        _poll?.cancel();
        operation = null;
        session = null;
        acknowledgment = null;
        if (hasSavedReservation) {
          pending = {...pending!}..remove('reservationConfirmed');
          await store.write('pending', jsonEncode(pending));
        }
        error =
            'The saved session is missing on the server. Use Report a problem or ask staff to repair its records. The saved operation has been kept.';
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
    if (await _restoreUnverifiedSession(id as String)) return;
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

  Future<bool> _restoreUnverifiedSession(String id) async {
    final command = operation?['command'] as Json?;
    if (!startupUnverified ||
        pending?['operationId'] != id ||
        session?['id'] != id ||
        command?['commandId'] != id) {
      return false;
    }
    // The API confirmed a reservation, not successful PC power-on. Keep the
    // original journal so restart, reporting and duplicate-start protection work.
    pending = {
      ...pending!,
      'reservationConfirmed': true,
      'workstationId': session!['workstationId'],
    };
    await store.write('pending', jsonEncode(pending));
    acknowledgment = 'unknown';
    cloudFresh = false;
    _poll?.cancel();
    screen = 'session';
    scheduleReset();
    notifyListeners();
    return true;
  }

  Future<void> checkout({String? reason}) async {
    final id = session!['id'] as String;
    final pc = session!['workstationId'];
    try {
      await repository.post('/sessions/$id/close', {
        'reason': reason,
        if (scanRequestId != null) 'scanRequestId': scanRequestId,
      });
    } on ApiFailure catch (e) {
      if (admin ||
          e.status != 409 ||
          !e.message.contains('Power delivery is pending')) {
        rethrow;
      }
      // The server refuses to release a PC while its power-on is unconfirmed.
      throw ApiFailure(
        'Your session cannot end yet because the computer has not confirmed it started. Use Report a problem or ask staff for help.',
        e.status,
      );
    }
    await _forgetSavedCheckIn(id);
    await clearPending();
    resetStudent();
    if (!admin) {
      sessionEndConfirmation =
          'Session ended${pc == null ? '' : ' on $pc'}. Thank you!';
      notifyListeners();
    }
  }

  Future<void> report(String description) async {
    final id = session?['id'] ?? pending?['operationId'];
    if (id == null) {
      throw ApiFailure('No session or saved operation to report.');
    }
    if (description.trim().isEmpty) {
      throw ApiFailure('Describe the problem first.');
    }
    final result = await repository.post('/issues', {
      'sessionId': id,
      'description': description.trim(),
      if (scanRequestId != null) 'scanRequestId': scanRequestId,
    });
    if (result['sessionClosed'] != true) {
      if (result['id'] is! String || (result['id'] as String).isEmpty) {
        throw ApiFailure(
          'Your report could not be confirmed. Please try again or ask staff.',
        );
      }
      // Older APIs save the issue without closing the assignment. A receipt is
      // sufficient to return home, but never claim the server released the PC.
      await _archivePending();
      resetStudent();
      reportConfirmation =
          'Report submitted. Staff will check the computer and help finish your session.';
      notifyListeners();
      return;
    }
    await _forgetSavedCheckIn(id as String);
    await clearPending();
    resetStudent();
    reportConfirmation =
        'Report submitted. Your session has ended. Staff will inspect the workstation.';
    notifyListeners();
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
    _disposed = true;
    stopPcStatusPolling();
    stopFingerprintScan();
    _welcome?.cancel();
    _poll?.cancel();
    super.dispose();
  }
}
