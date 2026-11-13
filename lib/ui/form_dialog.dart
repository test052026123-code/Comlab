import 'package:flutter/material.dart';

/// Keeps editor actions accessible without consuming a second row above an IME.
class FormDialog extends StatelessWidget {
  const FormDialog({
    super.key,
    required this.title,
    required this.content,
    required this.actions,
  });

  final String title;
  final Widget content;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final keyboard = MediaQuery.viewInsetsOf(context).bottom > 0;
    final theme = Theme.of(context);
    final compactTheme = theme.copyWith(
      inputDecorationTheme: theme.inputDecorationTheme.copyWith(
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 12,
          vertical: 12,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: theme.filledButtonTheme.style?.copyWith(
          minimumSize: const WidgetStatePropertyAll(Size(64, 40)),
          padding: const WidgetStatePropertyAll(
            EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          ),
        ),
      ),
    );
    return AlertDialog(
      insetPadding: keyboard
          ? const EdgeInsets.symmetric(horizontal: 12, vertical: 4)
          : const EdgeInsets.symmetric(horizontal: 40, vertical: 24),
      titlePadding: keyboard ? const EdgeInsets.fromLTRB(16, 4, 8, 0) : null,
      contentPadding: keyboard
          ? const EdgeInsets.fromLTRB(16, 8, 16, 12)
          : null,
      title: keyboard
          ? Theme(
              data: compactTheme,
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleLarge,
                    ),
                  ),
                  const SizedBox(width: 8),
                  ...actions,
                ],
              ),
            )
          : Text(title),
      // Keep the Theme in both layouts so IME insets do not replace the focused
      // field subtree and immediately dismiss the keyboard.
      content: Theme(data: keyboard ? compactTheme : theme, child: content),
      actions: keyboard ? null : actions,
    );
  }
}
