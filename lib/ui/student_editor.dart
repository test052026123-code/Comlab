import 'package:flutter/material.dart';
import '../core/contracts.dart';

class StudentEditorDialog extends StatefulWidget {
  const StudentEditorDialog({super.key, this.student});
  final Json? student;

  @override
  State<StudentEditorDialog> createState() => _StudentEditorDialogState();
}

class _StudentEditorDialogState extends State<StudentEditorDialog> {
  late final TextEditingController id, name, section;
  late bool active;

  @override
  void initState() {
    super.initState();
    final student = widget.student;
    id = TextEditingController(text: student?['id'] as String?);
    name = TextEditingController(text: student?['name'] as String?);
    section = TextEditingController(text: student?['section'] as String?);
    active = student?['active'] as bool? ?? true;
  }

  @override
  void dispose() {
    id.dispose();
    name.dispose();
    section.dispose();
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
          ],
        ),
      ),
    ),
    actions: [
      TextButton(onPressed: () => close(), child: const Text('Cancel')),
      FilledButton(
        onPressed: () => close({
          'id': id.text,
          'name': name.text.trim(),
          'section': section.text.trim(),
          'active': active,
        }),
        child: const Text('Save'),
      ),
    ],
  );
}
