import 'dart:async';
import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import '../core/contracts.dart';
import 'widgets.dart';

/// Enrolls a student's finger on the central AS608 through the cloud. The
/// server picks the slot and links it to the student once the sensor stores it.
class FingerprintEnrollDialog extends StatefulWidget {
  const FingerprintEnrollDialog({
    super.key,
    required this.repository,
    required this.student,
  });
  final LabRepository repository;
  final Json student;
  @override
  State<FingerprintEnrollDialog> createState() =>
      _FingerprintEnrollDialogState();
}

class _FingerprintEnrollDialogState extends State<FingerprintEnrollDialog> {
  String? requestId, error;
  Json? result;
  bool busy = false;
  Timer? poll;
  bool get waiting => result?['state'] == 'waiting';
  bool get enrolled => result?['state'] == 'enrolled';

  Future<void> start() async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    // Reuse the ID after an uncertain POST so a retry cannot double-start.
    requestId ??= const Uuid().v4();
    try {
      final reply = await widget.repository.post('/admin/fingerprint/enroll', {
        'requestId': requestId,
        'studentId': widget.student['id'],
      });
      if (!mounted) return;
      setState(() => result = reply);
      if (waiting) startPolling();
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  void startPolling() {
    poll?.cancel();
    poll = Timer.periodic(const Duration(milliseconds: 1500), (_) {
      if (!busy) unawaited(refresh());
    });
  }

  Future<void> refresh() async {
    if (busy || requestId == null) return;
    busy = true;
    try {
      final reply = await widget.repository.get(
        '/fingerprint/requests/$requestId',
      );
      if (!mounted) return;
      setState(() {
        result = reply;
        error = null;
      });
      if (!waiting) poll?.cancel();
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      busy = false;
    }
  }

  Future<void> cancel() async {
    poll?.cancel();
    final id = requestId;
    if (id != null && waiting) {
      unawaited(
        widget.repository
            .post('/fingerprint/requests/$id/cancel', {})
            .catchError((_) => <String, dynamic>{}),
      );
    }
  }

  @override
  void dispose() {
    poll?.cancel();
    super.dispose();
  }

  String get status => switch (result?['state']) {
    'waiting' => switch (result?['step']) {
      'lift' => 'Remove your finger from the sensor.',
      'place_second' => 'Place the SAME finger on the sensor again.',
      _ => 'Place the finger on the central fingerprint sensor.',
    },
    'enrolled' =>
      'Enrolled in slot ${result?['slot']} and linked to ${widget.student['name']}.',
    'duplicate' =>
      result?['duplicateStudentId'] != null
          ? 'This finger is already enrolled for student ${result?['duplicateStudentId']}.'
          : 'This finger is already stored on the sensor but not linked to a student.',
    'mismatch' => 'The two presses did not match. Try again with the same finger.',
    'conflict' =>
      'The slot was linked to another student meanwhile. Try again.',
    'canceled' => 'Enrollment canceled.',
    'expired' => 'Timed out. Check the central controller and try again.',
    'error' => 'The sensor reported an error. Try again.',
    _ =>
      requestId == null
          ? 'Ready. The server picks a free sensor slot'
                '${widget.student['fingerprintSlot'] != null ? ' (this student re-enrolls slot ${widget.student['fingerprintSlot']})' : ''}.'
          : 'Request outcome not yet known. Retry the same request.',
  };

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text('Enroll fingerprint · ${widget.student['name']}'),
    content: SizedBox(
      width: 480,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                enrolled ? Icons.check_circle : Icons.fingerprint,
                size: 48,
                color: enrolled ? Colors.green : navy,
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Text(
                  status,
                  style: const TextStyle(
                    color: navy,
                    fontWeight: FontWeight.w600,
                    fontSize: 16,
                  ),
                ),
              ),
            ],
          ),
          if (waiting) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(),
          ],
          if (error != null) ...[
            const SizedBox(height: 12),
            Notice(error!, error: true),
          ],
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () {
          unawaited(cancel());
          Navigator.pop(context, enrolled);
        },
        child: Text(waiting ? 'Cancel' : 'Close'),
      ),
      if (!waiting && !enrolled)
        FilledButton.icon(
          onPressed: busy
              ? null
              : () {
                  if (result != null) {
                    requestId = null;
                    result = null;
                  }
                  unawaited(start());
                },
          icon: const Icon(Icons.fingerprint),
          label: Text(
            requestId != null && result == null
                ? 'Retry same request'
                : 'Start enrollment',
          ),
        ),
    ],
  );
}
