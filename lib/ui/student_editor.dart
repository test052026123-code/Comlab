import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
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

  void generateId() {
    id.text = 'STU-${const Uuid().v4().replaceAll('-', '').toUpperCase()}';
    id.selection = TextSelection.collapsed(offset: id.text.length);
  }

  void save() {
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
  }

  @override
  Widget build(BuildContext context) => Dialog(
    insetPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    constraints: const BoxConstraints(maxWidth: 760, maxHeight: 680),
    clipBehavior: Clip.antiAlias,
    child: Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  widget.student == null ? 'Register student' : 'Edit student',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              TextButton(onPressed: () => close(), child: const Text('Cancel')),
              const SizedBox(width: 8),
              FilledButton(onPressed: save, child: const Text('Save')),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(20),
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            children: [
              TextField(
                controller: id,
                enabled: widget.student == null,
                textInputAction: TextInputAction.next,
                scrollPadding: const EdgeInsets.all(24),
                decoration: const InputDecoration(
                  labelText: 'Unique student ID',
                ),
              ),
              if (widget.student == null)
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    onPressed: generateId,
                    icon: const Icon(Icons.auto_awesome_outlined),
                    label: const Text('Generate ID'),
                  ),
                ),
              const SizedBox(height: 16),
              TextField(
                controller: name,
                textCapitalization: TextCapitalization.words,
                textInputAction: TextInputAction.next,
                scrollPadding: const EdgeInsets.all(24),
                decoration: const InputDecoration(labelText: 'Full name'),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: section,
                textInputAction: TextInputAction.next,
                scrollPadding: const EdgeInsets.all(24),
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
                textInputAction: TextInputAction.done,
                scrollPadding: const EdgeInsets.all(24),
                onSubmitted: (_) => FocusScope.of(context).unfocus(),
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
      ],
    ),
  );
}
