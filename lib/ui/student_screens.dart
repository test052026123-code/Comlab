import 'package:flutter/material.dart';
import '../core/lab_state.dart';
import 'lab_artwork.dart';
import 'widgets.dart';

class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key, required this.state});
  final LabState state;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) {
      final landscape = box.maxWidth >= 700 && box.maxWidth > box.maxHeight;
      final compact = box.maxHeight < 650;
      final intro = _intro(state, landscape, compact);
      final entry = _entry(state, compact);
      return Padding(
        padding: EdgeInsets.all(box.maxHeight < 430 ? 6 : (compact ? 12 : 24)),
        child: landscape
            ? Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(flex: 10, child: intro),
                  const SizedBox(width: 24),
                  Expanded(flex: 11, child: entry),
                ],
              )
            : Column(
                children: [
                  SizedBox(height: compact ? 145 : 230, child: intro),
                  const SizedBox(height: 16),
                  Expanded(child: entry),
                ],
              ),
      );
    },
  );

  Widget _intro(LabState s, bool landscape, bool compact) {
    final heading = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          'Welcome to the\nComputer Lab',
          style: TextStyle(
            fontSize: landscape ? (compact ? 36 : 48) : 30,
            height: 1.08,
            letterSpacing: -1,
            fontWeight: FontWeight.w900,
            color: navy,
          ),
        ),
        if (landscape) ...[
          const SizedBox(height: 12),
          Container(
            width: 60,
            height: 5,
            decoration: BoxDecoration(
              color: teal,
              borderRadius: BorderRadius.circular(8),
            ),
          ),
        ],
        const SizedBox(height: 8),
        Text(
          'Scan your fingerprint to check in and choose a computer.',
          style: TextStyle(
            fontSize: landscape ? (compact ? 15 : 18) : 14,
            height: 1.4,
            color: const Color(0xFF626575),
          ),
        ),
      ],
    );
    final summary = Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFE8F3EE),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Expanded(
            child: _metric(
              Icons.desktop_windows_outlined,
              s.cloudFresh ? '${s.pcs.length}' : '-',
              'Computers',
              navy,
            ),
          ),
          Expanded(
            child: _metric(
              Icons.check_circle,
              s.cloudFresh
                  ? '${s.pcs.where((p) => p['eligible'] == true).length}'
                  : '-',
              'Available',
              teal,
            ),
          ),
          Expanded(
            child: _metric(
              Icons.people_alt_outlined,
              s.cloudFresh
                  ? '${s.pcs.where((p) => p['sessionId'] != null).length}'
                  : '-',
              'In use',
              const Color(0xFFCC8709),
            ),
          ),
          IconButton(
            tooltip: 'Check workstation availability',
            onPressed: s.busy ? null : () => s.run(s.refreshPcs),
            icon: const Icon(Icons.refresh, color: teal, size: 19),
          ),
        ],
      ),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (landscape) ...[
          heading,
          const SizedBox(height: 8),
          const Expanded(child: Center(child: LabArtwork())),
        ] else
          Expanded(
            child: Row(
              children: [
                Expanded(child: heading),
                if (!compact) const SizedBox(width: 230, child: LabArtwork()),
              ],
            ),
          ),
        summary,
        if (landscape || !compact) ...[
          const SizedBox(height: 8),
          const Text(
            'Use your enrolled fingerprint. Attendance is recorded after PC confirmation.',
            style: TextStyle(fontSize: 11, color: Color(0xFF72768C)),
          ),
        ],
        if (!s.kioskSignedIn && landscape)
          SizedBox(
            height: 32,
            child: Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => s.navigate('setup'),
                child: const Text(
                  'Configure approved kiosk identity',
                  style: TextStyle(fontSize: 11),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _entry(LabState s, bool compact) => Container(
    key: const ValueKey('check-in-panel'),
    padding: EdgeInsets.all(compact ? 16 : 26),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: const Color(0xFFF0EAE5)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Fingerprint Check-in',
          style: TextStyle(
            fontSize: compact ? 24 : 32,
            fontWeight: FontWeight.w900,
            color: navy,
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Check in or find your active session.',
          style: TextStyle(color: Color(0xFF72768C)),
        ),
        Expanded(
          child: Center(
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.fingerprint,
                    size: compact ? 80 : 128,
                    color: teal,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    s.fingerprintScanning
                        ? 'Place your finger on the scanner'
                        : 'Ready to scan',
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: navy,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    s.fingerprintScanning
                        ? 'Lift your finger first, then place it again.'
                        : 'Tap below, then use your enrolled finger.',
                    style: const TextStyle(color: Color(0xFF72768C)),
                  ),
                ],
              ),
            ),
          ),
        ),
        if (s.pending != null) ...[
          const Notice(
            'A previous operation needs reconciliation before another check-in.',
          ),
          const SizedBox(height: 8),
          FilledButton.icon(
            onPressed: s.busy ? null : () => s.run(s.recover),
            icon: const Icon(Icons.sync),
            label: const Text('Recover pending operation'),
          ),
        ] else ...[
          SizedBox(
            height: 48,
            child: FilledButton.icon(
              key: const ValueKey('fingerprint-scan-button'),
              onPressed: s.busy || s.fingerprintScanning
                  ? null
                  : () => s.run(s.startFingerprintScan),
              icon: const Icon(Icons.fingerprint),
              label: Text(
                s.fingerprintScanning
                    ? 'Waiting for fingerprint...'
                    : 'Scan fingerprint',
              ),
            ),
          ),
          const SizedBox(height: 8),
          if (s.fingerprintScanning)
            TextButton(
              onPressed: s.busy
                  ? null
                  : () {
                      s.stopFingerprintScan();
                      s.navigate('welcome');
                    },
              child: const Text('Cancel scan'),
            )
          else
            const Text(
              'Not enrolled? Ask a laboratory administrator.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: Color(0xFF72768C)),
            ),
        ],
      ],
    ),
  );
  Widget _metric(IconData icon, String value, String label, Color color) =>
      Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: color, size: 19),
              const SizedBox(width: 5),
              Text(
                value,
                style: TextStyle(
                  fontWeight: FontWeight.w900,
                  color: color,
                  fontSize: 19,
                ),
              ),
            ],
          ),
          Text(label, style: const TextStyle(fontSize: 10, color: navy)),
        ],
      );
}

class PcSelection extends StatefulWidget {
  const PcSelection({super.key, required this.state});
  final LabState state;
  @override
  State<PcSelection> createState() => _PcSelectionState();
}

class _PcSelectionState extends State<PcSelection> {
  String? selected;
  @override
  Widget build(BuildContext context) {
    final s = widget.state;
    final pcs = [...s.pcs]
      ..sort((a, b) => '${a['id']}'.compareTo('${b['id']}'));
    final eligible = pcs.where((p) => p['eligible'] == true).toList();
    final canConfirm =
        selected != null &&
        !s.busy &&
        s.cloudFresh &&
        eligible.any((p) => p['id'] == selected);
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Choose your computer',
                      style: TextStyle(
                        fontSize: 28,
                        height: 1.1,
                        fontWeight: FontWeight.w900,
                        color: navy,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${s.student?['name'] ?? 'Student'} · Select an available workstation.',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 13,
                        color: Color(0xFF72768C),
                      ),
                    ),
                  ],
                ),
              ),
              TextButton.icon(
                onPressed: s.busy ? null : s.resetStudent,
                icon: const Icon(Icons.arrow_back, size: 18),
                label: const Text('Back'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Text(
                '${s.cloudFresh ? eligible.length : '-'} available',
                style: const TextStyle(
                  color: teal,
                  fontWeight: FontWeight.w800,
                  fontSize: 13,
                ),
              ),
              const Spacer(),
              IconButton(
                tooltip: 'Choose for me',
                onPressed: eligible.isEmpty || s.busy || !s.cloudFresh
                    ? null
                    : () => setState(
                        () => selected = eligible.first['id'] as String,
                      ),
                icon: const Icon(Icons.auto_awesome_outlined, size: 20),
              ),
              TextButton.icon(
                onPressed: s.busy ? null : () => s.run(s.refreshPcs),
                icon: const Icon(Icons.refresh, size: 18),
                label: const Text('Refresh status'),
              ),
            ],
          ),
          if (!s.cloudFresh)
            const Padding(
              padding: EdgeInsets.only(bottom: 8),
              child: Text(
                'Status is stale / read-only. Refresh before assigning.',
                style: TextStyle(color: Colors.deepOrange, fontSize: 12),
              ),
            ),
          Expanded(
            child: pcs.isEmpty
                ? const Center(
                    child: Notice(
                      'No workstations configured. Ask an administrator to create PC-01 through PC-05 and map their nodes.',
                    ),
                  )
                : LayoutBuilder(
                    builder: (context, grid) {
                      final columns =
                          grid.maxWidth >= 680 && grid.maxWidth > grid.maxHeight
                          ? 5
                          : grid.maxWidth >= 480
                          ? 3
                          : 2;
                      final rows = (pcs.length / columns).ceil();
                      return Column(
                        children: [
                          for (var row = 0; row < rows; row++) ...[
                            if (row > 0) const SizedBox(height: 12),
                            Expanded(
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  for (var col = 0; col < columns; col++) ...[
                                    if (col > 0) const SizedBox(width: 12),
                                    Expanded(
                                      child: row * columns + col >= pcs.length
                                          ? const SizedBox()
                                          : PcCard(
                                              pc: pcs[row * columns + col],
                                              fitHeight: true,
                                              selected:
                                                  selected ==
                                                  pcs[row * columns +
                                                      col]['id'],
                                              onTap:
                                                  pcs[row * columns +
                                                              col]['eligible'] ==
                                                          true &&
                                                      s.cloudFresh &&
                                                      !s.busy
                                                  ? () => setState(
                                                      () => selected =
                                                          pcs[row * columns +
                                                                  col]['id']
                                                              as String,
                                                    )
                                                  : null,
                                            ),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                          ],
                        ],
                      );
                    },
                  ),
          ),
          const SizedBox(height: 12),
          Container(
            key: const ValueKey('pc-confirmation-bar'),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(color: const Color(0xFFE8E6E2)),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        canConfirm
                            ? '$selected is your selection'
                            : 'Select a computer',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: navy,
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 3),
                      const Text(
                        'Saved after confirmation.',
                        style: TextStyle(
                          color: Color(0xFF72768C),
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                SizedBox(
                  height: 44,
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                    ),
                    onPressed: !canConfirm
                        ? null
                        : () async {
                            final id = selected!;
                            if (await confirm(
                              context,
                              'Reserve $id?',
                              'Assign this PC to ${s.student?['name']} and start your session?',
                            )) {
                              if (!mounted) return;
                              await s.run(() => s.reserve(id));
                            }
                          },
                    icon: const Icon(Icons.arrow_forward, size: 18),
                    label: Text(
                      'Confirm ${canConfirm ? selected : 'selection'}',
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class StudentSteps extends StatelessWidget {
  const StudentSteps({super.key, required this.screen});
  final String screen;
  @override
  Widget build(BuildContext context) {
    final active = ['map'].contains(screen)
        ? 1
        : ['progress', 'session', 'issue'].contains(screen)
        ? 2
        : 0;
    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFFFFFCF8),
        border: Border(top: BorderSide(color: Color(0xFFE6E0DA))),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 5),
      child: LayoutBuilder(
        builder: (context, box) => Row(
          children: [
            for (var i = 0; i < 3; i++) ...[
              if (i > 0)
                Expanded(
                  child: Container(
                    height: 1,
                    margin: const EdgeInsets.symmetric(horizontal: 14),
                    color: const Color(0xFFDCDDDC),
                  ),
                ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: i == active
                      ? const Color(0xFFD7F7ED)
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(30),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CircleAvatar(
                      radius: 13,
                      backgroundColor: i == active
                          ? teal
                          : const Color(0xFFE6E5E3),
                      child: Text(
                        '${i + 1}',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w800,
                          color: i == active ? Colors.white : navy,
                        ),
                      ),
                    ),
                    const SizedBox(width: 9),
                    Text(
                      ['Scan finger', 'Choose PC', 'Start session'][i],
                      style: TextStyle(
                        color: navy,
                        fontSize: box.maxWidth < 600 ? 11 : 13,
                        fontWeight: i == active
                            ? FontWeight.w800
                            : FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
            ],
            if (box.maxWidth > 1150) ...[
              const Spacer(),
              const Icon(Icons.help_outline, size: 18, color: navy),
              const SizedBox(width: 8),
              const Text(
                'Need help? Contact your instructor.',
                style: TextStyle(color: navy, fontSize: 12),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
