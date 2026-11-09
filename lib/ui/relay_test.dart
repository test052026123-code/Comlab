import 'dart:async';
import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import '../core/contracts.dart';
import 'widgets.dart';

class RelayTestDialog extends StatefulWidget {
  const RelayTestDialog({
    super.key,
    required this.repository,
    required this.pc,
  });
  final LabRepository repository;
  final Json pc;
  @override
  State<RelayTestDialog> createState() => _RelayTestDialogState();
}

class _RelayTestDialogState extends State<RelayTestDialog> {
  String? commandId, error;
  Json? result;
  bool busy = false;
  Timer? poll;
  bool get pending =>
      commandId != null && (result == null || result?['state'] == 'pending');

  Future<void> send() async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    commandId ??= const Uuid().v4();
    try {
      final reply = await widget.repository.post('/admin/relay-tests', {
        'commandId': commandId,
        'workstationId': widget.pc['id'],
      });
      if (!mounted) return;
      setState(() => result = reply);
      if (pending) startPolling();
    } catch (e) {
      if (mounted) setState(() => error = '$e');
      // Keep the same UUID. An uncertain POST must never create another test.
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  void startPolling() {
    poll?.cancel();
    poll = Timer.periodic(const Duration(seconds: 2), (_) {
      if (!busy) unawaited(refresh());
    });
  }

  Future<void> refresh() async {
    if (busy || commandId == null) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final reply = await widget.repository.get(
        '/admin/relay-tests/$commandId',
      );
      if (!mounted) return;
      setState(() => result = reply);
      if (!pending) poll?.cancel();
    } catch (e) {
      poll?.cancel();
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void dispose() {
    poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text('Test ${widget.pc['nodeId']} relay'),
    content: SizedBox(
      width: 480,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Bench test with no PC connected. One 300 ms relay pulse. Workstation availability stays unchanged.',
            ),
            const SizedBox(height: 16),
            Text(switch (result?['state']) {
              'pending' => 'Waiting for central and node acknowledgement...',
              'pulse_finished' =>
                'Node reported: pulse finished and GPIO released. Listen for the relay click or check its contacts.',
              'rejected' =>
                'Node rejected the test. Check its timer status or wait for the relay cooldown.',
              'unknown' =>
                'Delivery outcome is unknown. Check the node log before requesting another pulse.',
              _ =>
                commandId == null
                    ? 'Ready to send a test through the central controller.'
                    : 'Request outcome not yet known. Check the result or retry the same request.',
            }, style: const TextStyle(color: navy, fontWeight: FontWeight.w600)),
            if (error != null) ...[
              const SizedBox(height: 12),
              Notice(error!, error: true),
            ],
            if (commandId != null) ...[
              const SizedBox(height: 12),
              const Text(
                'Closing this window does not cancel a sent test.',
                style: TextStyle(fontSize: 12),
              ),
            ],
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Close'),
      ),
      if (commandId != null)
        TextButton(
          onPressed: busy ? null : refresh,
          child: const Text('Check result'),
        ),
      if (result?['state'] != 'pending')
        FilledButton.icon(
          onPressed: busy
              ? null
              : () {
                  if (result != null) {
                    commandId = null;
                    result = null;
                  }
                  unawaited(send());
                },
          icon: const Icon(Icons.electrical_services),
          label: Text(
            commandId != null && result == null
                ? 'Retry same request'
                : 'Test relay (300 ms)',
          ),
        ),
    ],
  );
}
