import 'dart:async';
import 'package:flutter/material.dart';
import 'theme.dart';

enum AlertKind { error, warning, success, info }

/// Large modal alert used for every fingerprint / network / check-in message.
/// Closes itself after [autoClose] so the kiosk never gets stuck on a dialog.
Future<void> showKioskAlert(
  BuildContext context, {
  required AlertKind kind,
  required String title,
  required String message,
  String button = 'OK',
  Duration autoClose = const Duration(seconds: 8),
}) {
  final (icon, color) = switch (kind) {
    AlertKind.error => (Icons.error_rounded, Palette.red),
    AlertKind.warning => (Icons.warning_amber_rounded, Palette.amber),
    AlertKind.success => (Icons.check_circle_rounded, Palette.green),
    AlertKind.info => (Icons.info_rounded, Palette.teal),
  };
  return showDialog<void>(
    context: context,
    barrierDismissible: true,
    builder: (ctx) => _AutoClose(
      after: autoClose,
      child: AlertDialog(
        backgroundColor: Palette.card,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        contentPadding: const EdgeInsets.fromLTRB(32, 32, 32, 8),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 72, color: color),
              const SizedBox(height: 16),
              Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700, color: Palette.navy)),
              const SizedBox(height: 10),
              Text(message, textAlign: TextAlign.center, style: const TextStyle(fontSize: 17, height: 1.4, color: Palette.muted)),
            ],
          ),
        ),
        actionsAlignment: MainAxisAlignment.center,
        actionsPadding: const EdgeInsets.fromLTRB(32, 16, 32, 28),
        actions: [
          SizedBox(
            width: double.infinity,
            height: 56,
            child: FilledButton(
              style: FilledButton.styleFrom(backgroundColor: color, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
              onPressed: () => Navigator.of(ctx).pop(),
              child: Text(button, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
            ),
          ),
        ],
      ),
    ),
  );
}

class _AutoClose extends StatefulWidget {
  const _AutoClose({required this.after, required this.child});
  final Duration after;
  final Widget child;
  @override
  State<_AutoClose> createState() => _AutoCloseState();
}

class _AutoCloseState extends State<_AutoClose> {
  Timer? _t;
  @override
  void initState() {
    super.initState();
    _t = Timer(widget.after, () {
      if (mounted) Navigator.of(context).maybePop();
    });
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
