import 'package:flutter/material.dart';
import '../core/contracts.dart';
import '../core/lab_state.dart';
import 'admin.dart';
import 'settings.dart';
import 'widgets.dart';
import 'student_screens.dart';

class ComLabApp extends StatelessWidget {
  const ComLabApp({super.key, required this.state});
  final LabState state;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'ComLab',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      scaffoldBackgroundColor: canvas,
      textTheme: ThemeData.light().textTheme.apply(
        bodyColor: navy,
        displayColor: navy,
      ),
      colorScheme: ColorScheme.fromSeed(
        seedColor: teal,
        primary: teal,
        secondary: navy,
        surface: Colors.white,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        contentPadding: const EdgeInsets.all(18),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(60, 54),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(11),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(minimumSize: const Size(60, 54)),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      ),
    ),
    home: ListenableBuilder(
      listenable: state,
      builder: (context, _) => LabShell(state: state),
    ),
  );
}

class LabShell extends StatelessWidget {
  const LabShell({super.key, required this.state});
  final LabState state;
  @override
  Widget build(BuildContext context) {
    if (!state.ready) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final studentMode =
        !state.admin && !['setup', 'settings', 'login'].contains(state.screen);
    return PopScope(
      canPop: false,
      child: Scaffold(
        appBar: AppBar(
          backgroundColor: const Color(0xFFFFFCF9),
          foregroundColor: navy,
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          shape: const Border(bottom: BorderSide(color: Color(0xFFE7E1DB))),
          toolbarHeight: MediaQuery.sizeOf(context).height < 600
              ? 48
              : MediaQuery.sizeOf(context).height < 700
              ? 56
              : 64,
          title: Row(
            children: [
              const Icon(
                Icons.desktop_windows_outlined,
                size: 33,
                color: Color(0xFF075563),
              ),
              const SizedBox(width: 16),
              Container(height: 32, width: 1, color: const Color(0xFFDAD6D2)),
              const SizedBox(width: 16),
              Flexible(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'ComLab',
                      style: TextStyle(
                        fontWeight: FontWeight.w900,
                        fontSize: 22,
                        letterSpacing: -.8,
                      ),
                    ),
                    if (MediaQuery.sizeOf(context).width >= 650)
                      const Text(
                        'Computer Laboratory Management',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontWeight: FontWeight.w400,
                          fontSize: 12,
                          color: Color(0xFF71758A),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
          actions: [
            if (studentMode && state.error != null)
              Semantics(
                liveRegion: true,
                label: state.error,
                child: TextButton.icon(
                  onPressed: () => showDialog<void>(
                    context: context,
                    builder: (dialogContext) => AlertDialog(
                      title: const Text('Unable to complete request'),
                      content: SingleChildScrollView(
                        child: Text(state.error ?? 'The request failed.'),
                      ),
                      actions: [
                        TextButton(
                          onPressed: () {
                            Navigator.pop(dialogContext);
                            state.dismissError();
                          },
                          child: const Text('Close'),
                        ),
                      ],
                    ),
                  ),
                  icon: const Icon(Icons.error_outline, size: 20),
                  label: const Text(
                    'View error',
                    style: TextStyle(fontSize: 12),
                  ),
                  style: TextButton.styleFrom(
                    foregroundColor: Colors.deepOrange,
                  ),
                ),
              ),
            if (MediaQuery.sizeOf(context).width >= 900 &&
                !(studentMode && state.error != null)) ...[
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: state.cloudFresh
                      ? const Color(0xFFE1F7DD)
                      : const Color(0xFFF0EEEA),
                  borderRadius: BorderRadius.circular(30),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.circle,
                      size: 8,
                      color: state.cloudFresh
                          ? const Color(0xFF18AB38)
                          : Colors.blueGrey,
                    ),
                    const SizedBox(width: 7),
                    Text(
                      state.cloudFresh
                          ? 'Status updated'
                          : 'Status not checked',
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 20),
              const Text(
                'Student ID mode',
                style: TextStyle(color: Color(0xFF71758A), fontSize: 12),
              ),
              const SizedBox(width: 18),
            ],
            TextButton.icon(
              onPressed: state.busy
                  ? null
                  : () {
                      if (state.admin) {
                        state.run(state.leaveAdmin);
                      } else {
                        state.navigate('login');
                      }
                    },
              icon: Icon(
                state.admin
                    ? Icons.logout
                    : Icons.admin_panel_settings_outlined,
              ),
              label: Text(state.admin ? 'Leave Admin' : 'Admin Login'),
              style: TextButton.styleFrom(foregroundColor: teal),
            ),
            const SizedBox(width: 16),
          ],
        ),
        body: Column(
          children: [
            if (state.busy) const LinearProgressIndicator(minHeight: 3),
            if (state.error != null && !studentMode)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
                child: Notice(state.error!, error: true),
              ),
            Expanded(
              child: switch (state.screen) {
                'setup' => SettingsScreen(state: state, initial: true),
                'settings' => SettingsScreen(state: state),
                'login' => LoginScreen(state: state),
                'admin' => AdminScreen(state: state),
                'confirm' => _confirmation(),
                'map' => PcSelection(state: state),
                'progress' => _progress(),
                'session' => _session(context),
                'issue' => IssueScreen(state: state),
                _ => WelcomeScreen(state: state),
              },
            ),
            if (!state.admin &&
                !['setup', 'settings', 'login'].contains(state.screen))
              StudentSteps(screen: state.screen),
          ],
        ),
      ),
    );
  }

  Widget _page(List<Widget> children) => Center(
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 800),
      child: ListView(padding: const EdgeInsets.all(28), children: children),
    ),
  );
  Widget _confirmation() => _page([
    titleBlock(
      'Confirm your record',
      'Student ID — temporary. ID entry does not verify who you are.',
    ),
    Card(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.badge_outlined, color: teal, size: 44),
            const SizedBox(height: 20),
            Text(
              '${state.student?['name']}',
              style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text('${state.student?['id']} • ${state.student?['section']}'),
          ],
        ),
      ),
    ),
    const SizedBox(height: 24),
    action(
      'Choose a workstation',
      state.busy ? null : () => state.run(state.showMap),
    ),
    TextButton(
      onPressed: state.resetStudent,
      child: const Text('This is not my record / Return'),
    ),
  ]);
  Widget _progress() {
    final command = state.operation?['command'] as Json?,
        status = state.operation?['command']?['state'] as String?;
    final on =
        status == 'confirmed_on' ||
        (state.operation != null && command == null);
    return _page([
      titleBlock(
        'Assignment & startup',
        'Each step reports its own confirmed result.',
      ),
      _step(
        'Assignment',
        state.session == null
            ? 'Pending / cloud result unknown'
            : '${state.session!['workstationId']} reserved in Firebase',
        state.session != null,
      ),
      _step(
        'Command acceptance',
        command == null && state.operation != null
            ? 'No pulse needed — PC already confirmed on'
            : state.acknowledgment ?? status ?? 'Not yet known',
        ['accepted', 'confirmed_on'].contains(state.acknowledgment) ||
            ['accepted', 'confirmed_on'].contains(status),
      ),
      _step(
        'Startup confirmation',
        on ? 'PC confirmed on' : 'Waiting for controller power feedback',
        on,
      ),
      const Notice(
        'Accepted means queued by the controller. It does not confirm startup. Unknown delivery keeps the PC reserved. Recovery never sends a power pulse.',
      ),
      action(
        'Reconcile saved operation',
        state.busy ? null : () => state.run(state.recover),
        icon: Icons.sync,
      ),
      TextButton(
        onPressed: state.resetStudent,
        child: Text(
          state.admin
              ? 'Back to administration — keep reservation'
              : 'Return to welcome — keep reservation',
        ),
      ),
    ]);
  }

  Widget _step(String label, String status, bool done) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Card(
      child: ListTile(
        contentPadding: const EdgeInsets.all(18),
        leading: Icon(
          done ? Icons.check_circle : Icons.pending_outlined,
          color: done ? teal : Colors.orange,
          size: 34,
        ),
        title: Text(label, style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text(status),
      ),
    ),
  );
  Widget _session(BuildContext context) {
    final s = state.session ?? {};
    return _page([
      titleBlock(
        'Your laboratory session',
        'Repeated ID entry shows this session. Checkout requires confirmation.',
      ),
      Card(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.desktop_windows, color: teal, size: 48),
              const SizedBox(height: 16),
              Text(
                '${s['workstationId'] ?? '—'}',
                style: const TextStyle(
                  fontSize: 40,
                  fontWeight: FontWeight.w800,
                  color: navy,
                ),
              ),
              Text(
                '${s['name'] ?? state.student?['name'] ?? ''} • ${s['section'] ?? ''}',
              ),
              const SizedBox(height: 16),
              Text('Check-in: ${displayTime(s['timeIn'])}'),
              Text('Session: ${s['status'] ?? 'unknown'}'),
              if (state.operation != null)
                Text(
                  'Power: ${state.operation?['command']?['state'] ?? 'already on; no pulse sent'}',
                ),
            ],
          ),
        ),
      ),
      const SizedBox(height: 20),
      const Notice(
        'ID entry does not verify identity. Report an incorrect assignment to staff.',
      ),
      action(
        'Check out',
        state.busy
            ? null
            : () async {
                if (await confirm(
                  context,
                  'Check out of ${s['workstationId']}?',
                  'Record time-out and close your assignment? The PC will remain powered on.',
                )) {
                  await state.run(() => state.checkout());
                }
              },
        icon: Icons.logout,
      ),
      const SizedBox(height: 12),
      OutlinedButton.icon(
        onPressed: state.busy ? null : () => state.navigate('issue'),
        icon: const Icon(Icons.report_problem_outlined),
        label: const Text('Report an issue'),
      ),
      TextButton(
        onPressed: state.resetStudent,
        child: Text(
          state.admin ? 'Back to administration' : 'Done / Return to welcome',
        ),
      ),
    ]);
  }
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.state});
  final LabState state;
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final email = TextEditingController(), password = TextEditingController();
  late final api = TextEditingController(text: widget.state.apiUrl);
  @override
  void dispose() {
    email.dispose();
    password.dispose();
    api.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Center(
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 520),
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.all(28),
        children: [
          titleBlock(
            'Administrator sign in',
            'Use an account provisioned by your laboratory owner.',
          ),
          TextField(
            key: const ValueKey('admin-api-address'),
            controller: api,
            keyboardType: TextInputType.url,
            autocorrect: false,
            enableSuggestions: false,
            decoration: const InputDecoration(
              labelText: 'Trusted API HTTPS address',
              helperText:
                  'If the tunnel address changed, enter its current URL.',
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: email,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: 'Email'),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: password,
            obscureText: true,
            enableSuggestions: false,
            autocorrect: false,
            decoration: const InputDecoration(labelText: 'Password'),
          ),
          const SizedBox(height: 20),
          action(
            'Sign in',
            widget.state.busy
                ? null
                : () => widget.state.run(() async {
                    final signInEmail = email.text;
                    final signInPassword = password.text;
                    final signInApi = api.text.trim();
                    FocusScope.of(context).unfocus();
                    password.clear();
                    await widget.state.login(
                      signInEmail,
                      signInPassword,
                      asAdmin: true,
                      apiOverride: signInApi,
                    );
                  }),
          ),
          TextButton(
            onPressed: widget.state.resetStudent,
            child: const Text('Return to student mode'),
          ),
        ],
      ),
    ),
  );
}

class IssueScreen extends StatefulWidget {
  const IssueScreen({super.key, required this.state});
  final LabState state;
  @override
  State<IssueScreen> createState() => _IssueScreenState();
}

class _IssueScreenState extends State<IssueScreen> {
  final description = TextEditingController();
  @override
  void dispose() {
    description.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(28),
    children: [
      titleBlock(
        'Report an issue',
        '${widget.state.session?['workstationId']} • Describe what happened. Do not include passwords.',
      ),
      TextField(
        controller: description,
        maxLines: 5,
        maxLength: 300,
        decoration: const InputDecoration(labelText: 'Issue description'),
      ),
      const SizedBox(height: 20),
      action(
        'Send report',
        widget.state.busy
            ? null
            : () => widget.state.run(() async {
                if (description.text.trim().isEmpty) {
                  throw const FormatException('Describe the issue first.');
                }
                await widget.state.report(description.text.trim());
              }),
        icon: Icons.send_outlined,
      ),
      TextButton(
        onPressed: () => widget.state.navigate('session'),
        child: const Text('Back to session'),
      ),
    ],
  );
}
