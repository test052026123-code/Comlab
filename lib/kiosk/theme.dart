import 'package:flutter/material.dart';

/// ComLab palette (cream, navy, teal) kept from the original kiosk design.
abstract final class Palette {
  static const bg = Color(0xFFF7F3EE);
  static const card = Color(0xFFFFFCF9);
  static const line = Color(0xFFE7E1DB);
  static const navy = Color(0xFF1D2550);
  static const teal = Color(0xFF075563);
  static const mint = Color(0xFF009F91);
  static const muted = Color(0xFF71758A);
  static const green = Color(0xFF18AB38);
  static const amber = Color(0xFFD98A00);
  static const red = Color(0xFFD1453B);
  static const grey = Color(0xFFB9B5B0);
}

ThemeData kioskTheme() => ThemeData(
  useMaterial3: true,
  scaffoldBackgroundColor: Palette.bg,
  colorScheme: ColorScheme.fromSeed(seedColor: Palette.teal, surface: Palette.card),
  filledButtonTheme: FilledButtonThemeData(
    style: FilledButton.styleFrom(
      backgroundColor: Palette.teal,
      minimumSize: const Size(0, 60),
      textStyle: const TextStyle(fontSize: 19, fontWeight: FontWeight.w600),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
  ),
  outlinedButtonTheme: OutlinedButtonThemeData(
    style: OutlinedButton.styleFrom(
      foregroundColor: Palette.teal,
      minimumSize: const Size(0, 60),
      side: const BorderSide(color: Palette.teal, width: 1.5),
      textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
  ),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: Colors.white,
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
  ),
);
