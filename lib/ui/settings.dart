import 'package:flutter/material.dart';
import '../core/lab_state.dart';
import 'widgets.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, required this.state, this.initial = false});
  final LabState state;
  final bool initial;
  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final controller = TextEditingController(),
      token = TextEditingController(),
      email = TextEditingController(),
      password = TextEditingController(),
      timeout = TextEditingController(),
      welcome = TextEditingController();
  String diagnostics = '';
  @override
  void initState() {
    super.initState();
    controller.text = widget.state.controllerUrl;
    timeout.text = '${widget.state.timeoutMs}';
    welcome.text = '${widget.state.welcomeSeconds}';
  }

  @override
  void dispose() {
    for (final c in [controller, token, email, password, timeout, welcome]) {
      c.dispose();
    }
    super.dispose();
  }

  Widget field(String label, TextEditingController c, {bool secret = false}) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: TextField(
          controller: c,
          obscureText: secret,
          autocorrect: false,
          enableSuggestions: !secret,
          decoration: InputDecoration(labelText: label),
        ),
      );
  Future<void> diagnose() async {
    final s = widget.state;
    final results = <String>[];
    try {
      final h = await s.repository.get('/health');
      results.add('Firebase via trusted API: ${h['firebase']}');
      if (h['controllerTransport'] == 'cloud') {
        final controller = await s.repository.get('/controller/status');
        results.add(
          'Controller via cloud: ${controller['connected'] == true ? 'connected' : 'offline'}',
        );
        results.add(
          'Reported workstation nodes: ${controller['reportedNodes'] ?? 0}',
        );
        if (mounted) setState(() => diagnostics = results.join('\n\n'));
        return;
      }
    } catch (e) {
      results.add('Firebase via trusted API: $e');
    }
    try {
      await s.devices.health();
      results.add('Local controller from tablet: reachable');
    } catch (e) {
      results.add('Local controller from tablet: $e');
    }
    try {
      final nodes = await s.devices.nodes();
      for (final n in nodes['nodes'] as List) {
        results.add(
          '${n['workstationId']} / ${n['nodeId']}: ${n['connectivity']}, power ${n['power']}, observed ${n['observedAt']}',
        );
      }
      if ((nodes['nodes'] as List).isEmpty) {
        results.add('No workstation nodes reported.');
      }
    } catch (e) {
      results.add('Workstation nodes: $e');
    }
    if (mounted) setState(() => diagnostics = results.join('\n\n'));
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.state;
    if (!widget.initial && !s.admin) {
      return const Center(
        child: Text('Administrator authentication required.'),
      );
    }
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 850),
        child: ListView(
          padding: const EdgeInsets.all(28),
          children: [
            titleBlock(
              widget.initial
                  ? 'Connect your laboratory'
                  : 'Settings & diagnostics',
              'Secure cloud connection • Approved kiosk identity',
            ),
            if (s.setupError != null) Notice(s.setupError!, error: true),
            const Notice(
              'The cloud server address is already configured. Sign in with your approved account. Local controller settings are optional for LAN diagnostics.',
            ),
            const ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.cloud_done_outlined),
              title: Text('Cloud server'),
              subtitle: Text(LabState.trustedApiUrl),
            ),
            field(
              'Controller address (HTTPS or http://comlab-controller.local)',
              controller,
            ),
            field(
              s.pairingToken.isEmpty
                  ? 'Controller pairing token'
                  : 'Replace pairing token (leave blank to retain)',
              token,
              secret: true,
            ),
            field('Controller timeout in milliseconds (1000–15000)', timeout),
            action(
              'Save connection settings',
              s.busy
                  ? null
                  : () => s.run(() async {
                      final ms = int.tryParse(timeout.text);
                      if (ms == null || ms < 1000 || ms > 15000) {
                        throw const FormatException(
                          'Timeout must be 1000–15000 ms.',
                        );
                      }
                      await s.configure(controller.text.trim(), token.text, ms);
                      token.clear();
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text(
                              'Connection settings saved securely.',
                            ),
                          ),
                        );
                      }
                    }),
              icon: Icons.save_outlined,
            ),
            const SizedBox(height: 28),
            if (widget.initial || s.admin) ...[
              titleBlock(
                'Approved kiosk sign in',
                'Create and approve this dedicated account with the trusted provisioning CLI first. No public registration is available.',
              ),
              field('Kiosk account email', email),
              field('Kiosk account password', password, secret: true),
              action(
                'Authenticate kiosk',
                s.busy || s.setupError != null
                    ? null
                    : () => s.run(() async {
                        final signInEmail = email.text;
                        final signInPassword = password.text;
                        FocusScope.of(context).unfocus();
                        password.clear();
                        await s.login(
                          signInEmail,
                          signInPassword,
                          asAdmin: false,
                        );
                        if (mounted && s.admin) s.navigate('settings');
                      }),
                icon: Icons.tablet_android,
              ),
              const SizedBox(height: 24),
            ],
            if (s.admin) ...[
              field('Student return timeout in seconds (10–120)', welcome),
              action(
                'Save laboratory policy',
                s.busy
                    ? null
                    : () => s.run(() async {
                        final seconds = int.tryParse(welcome.text);
                        if (seconds == null || seconds < 10 || seconds > 120) {
                          throw const FormatException('Use 10–120 seconds.');
                        }
                        await s.repository.put('/admin/settings', {
                          'welcomeTimeoutSeconds': seconds,
                        });
                        s.welcomeSeconds = seconds;
                      }),
                icon: Icons.timer_outlined,
              ),
              const SizedBox(height: 16),
              const Notice(
                'Shutdown, restart and forced-off controls are disabled. Checkout leaves PCs on. Windows-client and controller capability support is required before adding these policies.',
              ),
              action(
                'Run connectivity diagnostics',
                s.busy ? null : () => s.run(diagnose),
                icon: Icons.network_check,
              ),
              if (diagnostics.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 20),
                  child: SelectableText(diagnostics),
                ),
              if (s.pending != null) ...[
                const SizedBox(height: 16),
                action(
                  'Recover saved operation',
                  s.busy ? null : () => s.run(s.recover),
                  icon: Icons.sync,
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: s.busy
                      ? null
                      : () async {
                          if (!await confirm(
                            context,
                            'Cancel uncommitted operation?',
                            'The server will refuse if a reservation already exists. Otherwise a cancellation record prevents delayed requests from committing.',
                          )) {
                            return;
                          }
                          await s.run(() async {
                            await s.repository.post(
                              '/admin/operations/${s.pending!['operationId']}/cancel-uncommitted',
                              {},
                            );
                            await s.clearPending();
                          });
                        },
                  icon: const Icon(Icons.cancel_outlined),
                  label: const Text(
                    'Cancel only if reservation never committed',
                  ),
                ),
              ],
              TextButton(
                onPressed: () => s.navigate('admin'),
                child: const Text('Back to administration'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
