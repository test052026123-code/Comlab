import 'dart:async';
import 'package:flutter/material.dart';
import 'alerts.dart';
import 'api.dart';
import 'theme.dart';

/// Opens the "place your finger" dialog and returns a verified scan id, or null.
/// Every failure is explained with a modal alert.
Future<String?> scanFingerprint(BuildContext context, KioskApi api, {String title = 'Scan your fingerprint'}) async {
  final outcome = await showDialog<_Outcome>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _ScanDialog(api: api, title: title),
  );
  if (!context.mounted || outcome == null) return null;
  if (outcome.scanId != null) return outcome.scanId;
  if (outcome.cancelled) return null;
  await showKioskAlert(context, kind: outcome.kind, title: outcome.title, message: outcome.message);
  return null;
}

class _Outcome {
  const _Outcome({this.scanId, this.cancelled = false, this.kind = AlertKind.error, this.title = '', this.message = ''});
  final String? scanId;
  final bool cancelled;
  final AlertKind kind;
  final String title, message;
}

class _ScanDialog extends StatefulWidget {
  const _ScanDialog({required this.api, required this.title});
  final KioskApi api;
  final String title;
  @override
  State<_ScanDialog> createState() => _ScanDialogState();
}

class _ScanDialogState extends State<_ScanDialog> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200))..repeat(reverse: true);
  String? _jobId;
  String _hint = 'Starting scanner…';
  bool _closed = false;

  @override
  void initState() {
    super.initState();
    _run();
  }

  @override
  void dispose() {
    _closed = true;
    _pulse.dispose();
    super.dispose();
  }

  void _finish(_Outcome o) {
    if (_closed || !mounted) return;
    _closed = true;
    Navigator.of(context).pop(o);
  }

  Future<void> _run() async {
    try {
      final job = await widget.api.post('/fingerprint/identify');
      _jobId = job['id'] as String;
      while (!_closed) {
        await Future<void>.delayed(const Duration(milliseconds: 400));
        if (_closed) return;
        final j = await widget.api.get('/fingerprint/requests/$_jobId');
        final state = j['state'] as String, message = (j['message'] ?? '') as String;
        switch (state) {
          case 'waiting':
            if (mounted) setState(() => _hint = message.isEmpty ? 'Place your finger on the scanner.' : message);
          case 'matched':
            return _finish(_Outcome(scanId: j['scanId'] as String));
          case 'no_match':
            return _finish(_Outcome(title: 'Fingerprint not recognised', message: message));
          case 'cancelled':
            return _finish(const _Outcome(cancelled: true));
          default:
            final noFinger = message.startsWith('No finger');
            return _finish(_Outcome(
              kind: noFinger ? AlertKind.warning : AlertKind.error,
              title: noFinger ? 'No finger detected' : 'Scanner problem',
              message: noFinger ? 'The scanner timed out. Tap Scan and place your finger flat on the glass.' : message,
            ));
        }
      }
    } on ApiError catch (e) {
      _finish(_Outcome(
        title: e.offline ? 'Lab server unreachable' : (e.status == 503 ? 'Scanner not ready' : 'Scan failed'),
        message: e.status == 503 ? '${e.message}\nPlease tell the lab staff.' : e.message,
      ));
    }
  }

  Future<void> _cancel() async {
    final id = _jobId;
    _finish(const _Outcome(cancelled: true));
    if (id != null) await widget.api.post('/fingerprint/requests/$id/cancel').catchError((_) => null);
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    backgroundColor: Palette.card,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
    contentPadding: const EdgeInsets.fromLTRB(40, 36, 40, 12),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(widget.title, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700, color: Palette.navy)),
        const SizedBox(height: 28),
        ScaleTransition(
          scale: Tween(begin: 0.92, end: 1.08).animate(CurvedAnimation(parent: _pulse, curve: Curves.easeInOut)),
          child: Container(
            width: 150,
            height: 150,
            decoration: BoxDecoration(color: Palette.mint.withValues(alpha: 0.12), shape: BoxShape.circle),
            child: const Icon(Icons.fingerprint, size: 110, color: Palette.teal),
          ),
        ),
        const SizedBox(height: 24),
        Text(_hint, textAlign: TextAlign.center, style: const TextStyle(fontSize: 18, color: Palette.muted)),
      ],
    ),
    actionsAlignment: MainAxisAlignment.center,
    actionsPadding: const EdgeInsets.fromLTRB(40, 8, 40, 28),
    actions: [
      SizedBox(width: 220, child: OutlinedButton(onPressed: _cancel, child: const Text('Cancel'))),
    ],
  );
}
