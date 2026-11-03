import 'package:flutter/material.dart';
import '../core/contracts.dart';
import 'widgets.dart';

class WorkstationEditorDialog extends StatefulWidget {
  const WorkstationEditorDialog({super.key, this.workstation, this.assigned});
  final Json? workstation, assigned;

  @override
  State<WorkstationEditorDialog> createState() =>
      _WorkstationEditorDialogState();
}

class _WorkstationEditorDialogState extends State<WorkstationEditorDialog> {
  late final TextEditingController id, node, notes;
  late bool enabled, maintenance;

  @override
  void initState() {
    super.initState();
    final pc = widget.workstation;
    id = TextEditingController(text: pc?['id'] as String?);
    node = TextEditingController(text: pc?['nodeId'] as String?);
    notes = TextEditingController(text: pc?['notes'] as String?);
    enabled = pc?['enabled'] as bool? ?? true;
    maintenance = pc?['maintenance'] as bool? ?? false;
  }

  @override
  void dispose() {
    id.dispose();
    node.dispose();
    notes.dispose();
    super.dispose();
  }

  void close([Json? values]) {
    FocusScope.of(context).unfocus();
    Navigator.pop(context, values);
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(
      widget.workstation == null
          ? 'Create PC-01 through PC-05'
          : '${widget.workstation!['id']} details',
    ),
    content: SizedBox(
      width: 500,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (widget.assigned case final assigned?)
              Notice(
                'Assigned: ${assigned['name']} • ${assigned['studentId']}\nSince ${displayTime(assigned['timeIn'])}',
              ),
            TextField(
              controller: id,
              enabled: widget.workstation == null,
              decoration: const InputDecoration(
                labelText: 'Workstation ID (PC-01 … PC-05)',
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: node,
              decoration: const InputDecoration(
                labelText: 'Unique node ID (uppercase)',
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: notes,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Maintenance notes'),
            ),
            SwitchListTile(
              title: const Text('Enabled for selection'),
              value: enabled,
              onChanged: (value) => setState(() => enabled = value),
            ),
            SwitchListTile(
              title: const Text('Maintenance restriction'),
              value: maintenance,
              onChanged: (value) => setState(() => maintenance = value),
            ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(onPressed: () => close(), child: const Text('Cancel')),
      FilledButton(
        onPressed: () => close({
          'id': id.text.trim().toUpperCase(),
          'nodeId': node.text.trim().toUpperCase(),
          'notes': notes.text,
          'enabled': enabled,
          'maintenance': maintenance,
        }),
        child: const Text('Save'),
      ),
    ],
  );
}
