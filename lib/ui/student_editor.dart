import 'package:flutter/material.dart';
import '../core/contracts.dart';

class StudentEditorDialog extends StatefulWidget {
  const StudentEditorDialog({super.key, this.student});
  final Json? student;

  @override
  State<StudentEditorDialog> createState() => _StudentEditorDialogState();
}

class _StudentEditorDialogState extends State<StudentEditorDialog> {
  late final TextEditingController id, name, section, fingerprintSlot;
  late bool active;
  String? slotError;

  @override
  void initState() {
    super.initState();
    final student = widget.student;
    id = TextEditingController(text: student?['id'] as String?);
    name = TextEditingController(text: student?['name'] as String?);
    section = TextEditingController(text: student?['section'] as String?);
    fingerprintSlot = TextEditingController(
      text: student?['fingerprintSlot']?.toString() ?? '',
    );
    active = student?['active'] as bool? ?? true;
  }

  @override
  void dispose() {
    id.dispose();
    name.dispose();
    section.dispose();
    fingerprintSlot.dispose();
    super.dispose();
  }

  void close([Json? values]) {
    FocusScope.of(context).unfocus();
    Navigator.pop(context, values);
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.student == null ? 'Register student' : 'Edit student'),
    content: SizedBox(
      width: 480,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: id,
              enabled: widget.student == null,
              decoration: const InputDecoration(labelText: 'Unique student ID'),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: name,
              decoration: const InputDecoration(labelText: 'Full name'),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: section,
              decoration: const InputDecoration(labelText: 'Section'),
            ),
            SwitchListTile(
              value: active,
              onChanged: (value) => setState(() => active = value),
              title: const Text('Active / eligible to check in'),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: fingerprintSlot,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                labelText: 'Fingerprint slot',
                helperText:
                    'Set automatically by the fingerprint button in the student list.\nEdit only to link a USB-enrolled slot; leave blank to unlink.',
                helperMaxLines: 3,
                errorText: slotError,
              ),
            ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(onPressed: () => close(), child: const Text('Cancel')),
      FilledButton(
        onPressed: () {
          final raw = fingerprintSlot.text.trim();
          final slot = int.tryParse(raw);
          if (raw.isNotEmpty && (slot == null || slot < 0 || slot > 999)) {
            setState(
              () => slotError =
                  'Enter a slot from 0 to 999, within your sensor capacity.',
            );
            return;
          }
          close({
            'id': id.text,
            'name': name.text.trim(),
            'section': section.text.trim(),
            'active': active,
            'fingerprintSlot': raw.isEmpty ? null : slot,
          });
        },
        child: const Text('Save'),
      ),
    ],
  );
}
