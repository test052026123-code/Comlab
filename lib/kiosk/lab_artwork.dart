import 'package:flutter/material.dart';

/// Resolution-independent artwork, bundled with the app and available offline.
class LabArtwork extends StatelessWidget {
  const LabArtwork({super.key, this.single = false, this.muted = false});
  final bool single, muted;

  @override
  Widget build(BuildContext context) => AspectRatio(
    aspectRatio: single ? 1.8 : 2.05,
    child: CustomPaint(
      painter: _LabPainter(single: single, muted: muted),
    ),
  );
}

class _LabPainter extends CustomPainter {
  _LabPainter({required this.single, required this.muted});
  final bool single, muted;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 480, size.height / 250);
    final ink = muted ? const Color(0xFF78918F) : const Color(0xFF075563);
    final green = muted ? const Color(0xFFB8CDCA) : const Color(0xFF009F91);
    void rect(Rect r, Color color, [double radius = 0]) => canvas.drawRRect(
      RRect.fromRectAndRadius(r, Radius.circular(radius)),
      Paint()..color = color,
    );
    void line(Offset a, Offset b, Color color, double width) => canvas.drawLine(
      a,
      b,
      Paint()
        ..color = color
        ..strokeWidth = width
        ..strokeCap = StrokeCap.round,
    );
    canvas.drawOval(
      const Rect.fromLTWH(10, 216, 460, 23),
      Paint()..color = const Color(0xFFDDEBE6),
    );
    canvas.drawCircle(
      const Offset(290, 125),
      118,
      Paint()..color = const Color(0xFFDDF2E9),
    );
    for (var i = 0; i < 4; i++) {
      for (var j = 0; j < 3; j++) {
        canvas.drawCircle(
          Offset(409 + i * 12, 28 + j * 12),
          2,
          Paint()..color = const Color(0xFF9ADCCE),
        );
      }
    }
    rect(const Rect.fromLTWH(28, 160, 424, 9), const Color(0xFFB8C9CD), 3);
    rect(const Rect.fromLTWH(38, 169, 11, 56), const Color(0xFFA5B7C0), 2);
    rect(const Rect.fromLTWH(431, 169, 11, 56), const Color(0xFFA5B7C0), 2);
    final positions = single ? [188.0] : [79.0, 198.0, 317.0];
    for (final x in positions) {
      rect(Rect.fromLTWH(x, 84, 89, 59), ink, 5);
      final screen = Rect.fromLTWH(x + 4, 88, 81, 47);
      canvas.drawRRect(
        RRect.fromRectAndRadius(screen, const Radius.circular(2)),
        Paint()
          ..shader = LinearGradient(
            colors: [const Color(0xFF7DE0CE), green],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ).createShader(screen),
      );
      final wave = Path()
        ..moveTo(x + 4, 123)
        ..cubicTo(x + 30, 150, x + 57, 90, x + 85, 108)
        ..lineTo(x + 85, 135)
        ..lineTo(x + 4, 135)
        ..close();
      canvas.drawPath(wave, Paint()..color = ink.withValues(alpha: .17));
      rect(Rect.fromLTWH(x + 37, 143, 15, 12), ink, 1);
      rect(Rect.fromLTWH(x + 25, 154, 39, 4), ink, 2);
      rect(Rect.fromLTWH(x + 10, 159, 69, 3), const Color(0xFFD8E4E5), 2);
      if (!single) {
        rect(Rect.fromLTWH(x + 12, 167, 65, 43), green, 12);
        rect(Rect.fromLTWH(x + 9, 204, 71, 8), ink, 4);
        line(Offset(x + 44, 212), Offset(x + 44, 226), ink, 5);
        line(Offset(x + 44, 222), Offset(x + 21, 228), ink, 3);
        line(Offset(x + 44, 222), Offset(x + 68, 228), ink, 3);
        for (final dx in [20.0, 45.0, 69.0]) {
          canvas.drawCircle(Offset(x + dx, 230), 4, Paint()..color = ink);
        }
      }
    }
    rect(const Rect.fromLTWH(40, 139, 18, 21), Colors.white, 3);
    line(const Offset(49, 141), const Offset(48, 116), green, 3);
    canvas.drawOval(
      const Rect.fromLTWH(35, 113, 10, 23),
      Paint()..color = green,
    );
    canvas.drawOval(
      const Rect.fromLTWH(50, 107, 10, 24),
      Paint()..color = const Color(0xFF56BF9E),
    );
    rect(const Rect.fromLTWH(414, 148, 31, 7), Colors.white, 2);
    rect(const Rect.fromLTWH(414, 146, 31, 2), green, 1);
    rect(const Rect.fromLTWH(418, 156, 29, 4), ink, 1);
  }

  @override
  bool shouldRepaint(covariant _LabPainter oldDelegate) =>
      single != oldDelegate.single || muted != oldDelegate.muted;
}
