import 'package:flutter/material.dart';
import '../core/contracts.dart';
import 'lab_artwork.dart';

const navy = Color(0xFF15213F),
    teal = Color(0xFF008F87),
    canvas = Color(0xFFFFFAF5);
Widget titleBlock(String title, String subtitle) => Padding(
  padding: const EdgeInsets.only(bottom: 24),
  child: Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        title,
        style: const TextStyle(
          fontSize: 30,
          fontWeight: FontWeight.w800,
          color: navy,
        ),
      ),
      const SizedBox(height: 8),
      Text(
        subtitle,
        style: const TextStyle(fontSize: 16, color: Colors.blueGrey),
      ),
    ],
  ),
);

class Notice extends StatelessWidget {
  const Notice(this.message, {super.key, this.error = false});
  final String message;
  final bool error;
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    margin: const EdgeInsets.only(bottom: 16),
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: error ? const Color(0xFFFFECE9) : const Color(0xFFE6F4F2),
      borderRadius: BorderRadius.circular(12),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          error ? Icons.error_outline : Icons.info_outline,
          color: error ? Colors.deepOrange : teal,
        ),
        const SizedBox(width: 12),
        Expanded(child: Text(message)),
      ],
    ),
  );
}

Widget action(
  String text,
  VoidCallback? onPressed, {
  IconData icon = Icons.arrow_forward,
}) => FilledButton.icon(
  onPressed: onPressed,
  icon: Icon(icon),
  label: Text(text),
);

class PcCard extends StatelessWidget {
  const PcCard({
    super.key,
    required this.pc,
    this.onTap,
    this.selected = false,
    this.admin = false,
    this.fitHeight = false,
  });
  final Json pc;
  final VoidCallback? onTap;
  final bool selected, admin, fitHeight;
  @override
  Widget build(BuildContext context) {
    final node = pc['node'] as Json? ?? {};
    final available = pc['eligible'] == true;
    final occupied = pc['sessionId'] != null || pc['assignment'] == 'assigned';
    final status = pc['maintenance'] == true
        ? 'Maintenance'
        : pc['enabled'] == false
        ? 'Disabled'
        : occupied
        ? 'In use'
        : available
        ? 'Available'
        : 'Unavailable';
    final color = available
        ? teal
        : occupied
        ? const Color(0xFFB57812)
        : const Color(0xFF79828F);
    return Semantics(
      selected: selected,
      button: onTap != null,
      label: '${pc['id']}, $status',
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: selected ? teal : const Color(0xFFE5E4E1),
            width: selected ? 2 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: selected
                  ? const Color(0x20008F87)
                  : const Color(0x09504234),
              blurRadius: selected ? 18 : 10,
              offset: const Offset(0, 5),
            ),
          ],
        ),
        clipBehavior: Clip.antiAlias,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap,
            child: fitHeight
                ? _fixedContents(status, color, available, node)
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Container(
                        color: selected
                            ? const Color(0xFFE2F6EF)
                            : const Color(0xFFF1F6F2),
                        padding: const EdgeInsets.fromLTRB(14, 14, 14, 0),
                        child: Column(
                          children: [
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 9,
                                    vertical: 5,
                                  ),
                                  decoration: BoxDecoration(
                                    color: Colors.white.withValues(alpha: .9),
                                    borderRadius: BorderRadius.circular(20),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(Icons.circle, color: color, size: 7),
                                      const SizedBox(width: 5),
                                      Text(
                                        status,
                                        style: TextStyle(
                                          color: color,
                                          fontWeight: FontWeight.w700,
                                          fontSize: 11,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                const Spacer(),
                                Icon(
                                  selected
                                      ? Icons.check_circle
                                      : Icons.radio_button_unchecked,
                                  color: selected
                                      ? teal
                                      : const Color(0xFFB8C9C4),
                                  size: 23,
                                ),
                              ],
                            ),
                            LabArtwork(single: true, muted: !available),
                          ],
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.all(18),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    '${pc['id']}',
                                    style: const TextStyle(
                                      fontSize: 27,
                                      fontWeight: FontWeight.w900,
                                      letterSpacing: -.8,
                                      color: navy,
                                    ),
                                  ),
                                ),
                                const Icon(
                                  Icons.desktop_windows_outlined,
                                  size: 22,
                                  color: teal,
                                ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            const Text(
                              'Computer workstation',
                              style: TextStyle(
                                color: Color(0xFF7B8090),
                                fontSize: 12,
                              ),
                            ),
                            const SizedBox(height: 17),
                            Row(
                              children: [
                                Icon(
                                  Icons.power_settings_new,
                                  size: 16,
                                  color: color,
                                ),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Text(
                                    'Power: ${node['power'] ?? 'unknown'}',
                                    style: const TextStyle(
                                      fontSize: 12,
                                      color: Color(0xFF72768C),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            if (admin) ...[
                              const SizedBox(height: 7),
                              Text(
                                'Node: ${pc['nodeId'] ?? 'unmapped'} ? ${node['connectivity'] ?? 'unknown'}',
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: Colors.blueGrey,
                                ),
                              ),
                            ],
                            const SizedBox(height: 17),
                            Container(
                              padding: const EdgeInsets.symmetric(vertical: 11),
                              decoration: BoxDecoration(
                                color: selected
                                    ? teal
                                    : available
                                    ? const Color(0xFFE6F5F0)
                                    : const Color(0xFFF1F1EF),
                                borderRadius: BorderRadius.circular(9),
                              ),
                              child: Text(
                                admin
                                    ? 'View workstation'
                                    : selected
                                    ? 'Selected'
                                    : available
                                    ? 'Select computer'
                                    : status,
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  color: selected
                                      ? Colors.white
                                      : available
                                      ? teal
                                      : const Color(0xFF878C95),
                                  fontWeight: FontWeight.w800,
                                  fontSize: 13,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }

  Widget _fixedContents(
    String status,
    Color color,
    bool available,
    Json node,
  ) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Expanded(
        child: Container(
          color: selected ? const Color(0xFFE2F6EF) : const Color(0xFFF1F6F2),
          padding: const EdgeInsets.fromLTRB(10, 10, 10, 0),
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      status,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: color,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  Icon(
                    selected
                        ? Icons.check_circle
                        : Icons.radio_button_unchecked,
                    color: selected ? teal : const Color(0xFFB8C9C4),
                    size: 20,
                  ),
                ],
              ),
              Expanded(
                child: Center(
                  child: FittedBox(
                    fit: BoxFit.contain,
                    child: SizedBox(
                      width: 260,
                      child: LabArtwork(single: true, muted: !available),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
      Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '${pc['id']}',
              maxLines: 1,
              style: const TextStyle(
                fontSize: 24,
                height: 1.1,
                fontWeight: FontWeight.w900,
                color: navy,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Power: ${node['power'] ?? 'unknown'}',
              maxLines: 1,
              style: const TextStyle(fontSize: 11, color: Color(0xFF72768C)),
            ),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(vertical: 9),
              decoration: BoxDecoration(
                color: selected
                    ? teal
                    : available
                    ? const Color(0xFFE6F5F0)
                    : const Color(0xFFF1F1EF),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Text(
                selected
                    ? 'Selected'
                    : available
                    ? 'Select PC'
                    : status,
                maxLines: 1,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: selected ? Colors.white : color,
                  fontWeight: FontWeight.w800,
                  fontSize: 12,
                ),
              ),
            ),
          ],
        ),
      ),
    ],
  );
}

Future<bool> confirm(
  BuildContext context,
  String title,
  String message,
) async =>
    await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Confirm'),
          ),
        ],
      ),
    ) ??
    false;
String displayTime(dynamic value) {
  final time = DateTime.tryParse('$value');
  if (time == null) return '—';
  final lab = time.toUtc().add(const Duration(hours: 8));
  String two(int n) => n.toString().padLeft(2, '0');
  return '${lab.year}-${two(lab.month)}-${two(lab.day)} ${two(lab.hour)}:${two(lab.minute)} PHT';
}
