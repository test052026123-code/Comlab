import 'package:flutter/material.dart';
import 'core/lab_state.dart';
import 'ui/app.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final state = LabState();
  runApp(ComLabApp(state: state));
  await state.initialize();
}
