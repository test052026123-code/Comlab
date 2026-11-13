import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'kiosk/api.dart';
import 'kiosk/screens.dart';
import 'kiosk/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  final api = KioskApi();
  await api.load();
  runApp(KioskApp(api: api));
}

class KioskApp extends StatefulWidget {
  const KioskApp({super.key, required this.api, this.idleSeconds = 45});
  final KioskApi api;
  final int idleSeconds;
  @override
  State<KioskApp> createState() => _KioskAppState();
}

class _KioskAppState extends State<KioskApp> {
  final _nav = GlobalKey<NavigatorState>();
  late bool _setup = !widget.api.paired;
  Timer? _idle;

  // Any screen left untouched returns to Home so the next student starts clean.
  void _touch() {
    _idle?.cancel();
    _idle = Timer(Duration(seconds: widget.idleSeconds), () => _nav.currentState?.popUntil((r) => r.isFirst));
  }

  @override
  void dispose() {
    _idle?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'ComLab Kiosk',
    debugShowCheckedModeBanner: false,
    theme: kioskTheme(),
    navigatorKey: _nav,
    builder: (context, child) => Listener(behavior: HitTestBehavior.translucent, onPointerDown: (_) => _touch(), child: child),
    home: _setup
        ? SetupScreen(api: widget.api, canCancel: widget.api.paired, onDone: () => setState(() => _setup = false))
        : HomeScreen(key: const ValueKey('home'), api: widget.api, onSetup: () => setState(() => _setup = true)),
  );
}
