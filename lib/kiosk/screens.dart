import 'dart:async';
import 'package:flutter/material.dart';
import 'alerts.dart';
import 'api.dart';
import 'lab_artwork.dart';
import 'scan.dart';
import 'theme.dart';

const availableStates = {'IDLE', 'OFF'};

/// Shown as a big heading on every screen.
class Heading extends StatelessWidget {
  const Heading(this.title, {super.key, this.subtitle});
  final String title;
  final String? subtitle;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(title, style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800, color: Palette.navy)),
      if (subtitle != null) ...[
        const SizedBox(height: 6),
        Text(subtitle!, style: const TextStyle(fontSize: 18, color: Palette.muted)),
      ],
    ],
  );
}

// ============================================================ HOME
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.api, required this.onSetup});
  final KioskApi api;
  final VoidCallback onSetup;
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<dynamic> _pcs = [];
  bool _online = true, _busy = false;
  int _autoSeconds = 30;
  Timer? _refresh;

  @override
  void initState() {
    super.initState();
    _load();
    _refresh = Timer.periodic(const Duration(seconds: 10), (_) => _load());
  }

  @override
  void dispose() {
    _refresh?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await widget.api.get('/workstations/live');
      final s = await widget.api.get('/settings/kiosk');
      if (!mounted) return;
      setState(() {
        _pcs = r['workstations'] as List<dynamic>;
        _autoSeconds = (s['autoAssignAfterSeconds'] as num).toInt();
        _online = true;
      });
    } on ApiError catch (e) {
      if (!mounted) return;
      if (e.status == 401) return widget.onSetup();
      setState(() => _online = false);
    }
  }

  /// purpose: 'checkin' (normal) or 'report'.
  Future<void> _start(String purpose) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final scanId = await scanFingerprint(context, widget.api,
          title: purpose == 'report' ? 'Scan to report a problem' : 'Scan your fingerprint');
      if (scanId == null || !mounted) return;
      final who = await widget.api.get('/scans/$scanId');
      if (!mounted) return;
      if (who['type'] == 'staff') {
        await showKioskAlert(context, kind: AlertKind.info, title: 'Hello, ${who['user']['name']}',
            message: 'Staff tools are on the web dashboard:\n${widget.api.server}');
        return;
      }
      final student = who['student'] as Map<String, dynamic>;
      final open = who['openSession'] as Map<String, dynamic>?;
      Widget next;
      if (purpose == 'report') {
        next = ReportScreen(api: widget.api, scanId: scanId, student: student, session: open, pcs: _pcs);
      } else if (open != null) {
        next = SessionScreen(api: widget.api, scanId: scanId, student: student, session: open, cls: who['currentClass']);
      } else {
        next = PickScreen(api: widget.api, scanId: scanId, student: student, cls: who['currentClass'], autoSeconds: _autoSeconds);
      }
      await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => next));
    } on ApiError catch (e) {
      if (mounted) await showKioskAlert(context, kind: AlertKind.error, title: 'Something went wrong', message: e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final free = _pcs.where((p) => availableStates.contains(p['status'])).length;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Row(
            children: [
              Expanded(
                flex: 5,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    GestureDetector(
                      onLongPress: widget.onSetup, // hidden: re-pair / change server (needs admin login)
                      child: const Heading('ComLab', subtitle: 'Computer Laboratory Check-in'),
                    ),
                    const Spacer(),
                    const LabArtwork(),
                    const Spacer(),
                    _StatusPill(online: _online, free: free, total: _pcs.length),
                  ],
                ),
              ),
              const SizedBox(width: 40),
              Expanded(
                flex: 4,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SizedBox(
                      height: 260,
                      child: FilledButton(
                        onPressed: _busy ? null : () => _start('checkin'),
                        child: const Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.fingerprint, size: 110),
                            SizedBox(height: 12),
                            Text('Tap to scan fingerprint', style: TextStyle(fontSize: 24)),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    const Text('Time in · Time out · Choose a PC', textAlign: TextAlign.center, style: TextStyle(fontSize: 17, color: Palette.muted)),
                    const SizedBox(height: 28),
                    OutlinedButton.icon(
                      onPressed: _busy ? null : () => _start('report'),
                      icon: const Icon(Icons.report_problem_outlined),
                      label: const Text('Report a problem'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.online, required this.free, required this.total});
  final bool online;
  final int free, total;
  @override
  Widget build(BuildContext context) {
    final color = !online ? Palette.red : (free > 0 ? Palette.green : Palette.amber);
    final text = !online ? 'Lab server offline' : '$free of $total PCs available';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(40)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(online ? Icons.circle : Icons.wifi_off, size: 14, color: color),
        const SizedBox(width: 10),
        Text(text, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: color)),
      ]),
    );
  }
}

// ============================================================ PICK A PC
class PickScreen extends StatefulWidget {
  const PickScreen({super.key, required this.api, required this.scanId, required this.student, required this.cls, required this.autoSeconds});
  final KioskApi api;
  final String scanId;
  final Map<String, dynamic> student;
  final dynamic cls;
  final int autoSeconds;
  @override
  State<PickScreen> createState() => _PickScreenState();
}

class _PickScreenState extends State<PickScreen> {
  List<dynamic> _pcs = [];
  String? _selected;
  late int _left = widget.autoSeconds;
  Timer? _tick;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _load();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_selected != null || _sending) return;
      setState(() => _left--);
      if (_left <= 0) _confirm(auto: true);
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await widget.api.get('/workstations/live');
      if (mounted) setState(() => _pcs = r['workstations'] as List<dynamic>);
    } on ApiError catch (e) {
      if (mounted) showKioskAlert(context, kind: AlertKind.error, title: 'Cannot load PCs', message: e.message);
    }
  }

  Future<void> _confirm({bool auto = false}) async {
    if (_sending) return;
    setState(() => _sending = true);
    _tick?.cancel();
    try {
      final r = await widget.api.post('/checkin', {'scanId': widget.scanId, if (!auto && _selected != null) 'workstationId': _selected});
      if (!mounted) return;
      final power = r['powerOnRequired'] == true ? '\nPress the power button to turn it on.' : '';
      final how = r['assignment'] == 'auto' ? 'You were assigned' : 'Please go to';
      await showKioskAlert(context, kind: AlertKind.success, title: 'Time-in recorded',
          message: '$how ${r['label']}.$power', button: 'Done', autoClose: const Duration(seconds: 6));
      if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
    } on ApiError catch (e) {
      if (!mounted) return;
      await showKioskAlert(context, kind: AlertKind.error, title: 'Check-in failed', message: e.message);
      if (!mounted) return;
      // An expired or used scan cannot be retried; anything else lets the student pick again.
      if (e.status == 410 || e.message.toLowerCase().contains('scan')) return Navigator.of(context).popUntil((r) => r.isFirst);
      setState(() { _sending = false; _selected = null; });
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final cls = widget.cls;
    final sub = [widget.student['id'], widget.student['section'], if (cls != null) cls['subject']].whereType<String>().join(' · ');
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(32, 24, 32, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(children: [
                Expanded(child: Heading('Hi, ${widget.student['name']}! Choose a PC', subtitle: sub)),
                TextButton.icon(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close), label: const Text('Cancel', style: TextStyle(fontSize: 18))),
              ]),
              const SizedBox(height: 20),
              Expanded(child: LabMap(pcs: _pcs, selected: _selected, onTap: (id) => setState(() => _selected = id))),
              const SizedBox(height: 12),
              const _Legend(),
              const SizedBox(height: 16),
              Row(children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _sending ? null : () => _confirm(auto: true),
                    icon: const Icon(Icons.auto_awesome),
                    label: Text(_selected == null ? 'Assign me automatically ($_left s)' : 'Assign me automatically'),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: FilledButton(
                    onPressed: _selected == null || _sending ? null : _confirm,
                    child: Text(_selected == null ? 'Tap a green PC' : 'Confirm ${_label(_selected!)}'),
                  ),
                ),
              ]),
            ],
          ),
        ),
      ),
    );
  }

  String _label(String id) => (_pcs.firstWhere((p) => p['id'] == id, orElse: () => {'label': id})['label']) as String;
}

/// The interactive laboratory map. Uses saved map positions when the admin set
/// them in the dashboard; otherwise lays PCs out in a grid.
class LabMap extends StatelessWidget {
  const LabMap({super.key, required this.pcs, this.selected, this.onTap});
  final List<dynamic> pcs;
  final String? selected;
  final ValueChanged<String>? onTap;

  @override
  Widget build(BuildContext context) {
    if (pcs.isEmpty) return const Center(child: CircularProgressIndicator());
    final placed = pcs.any((p) => (p['mapX'] as num) != 0 || (p['mapY'] as num) != 0);
    return LayoutBuilder(builder: (context, box) {
      if (!placed) {
        final cols = pcs.length <= 6 ? 3 : (pcs.length <= 12 ? 4 : 6);
        return GridView.count(
          crossAxisCount: cols,
          mainAxisSpacing: 16,
          crossAxisSpacing: 16,
          childAspectRatio: box.maxWidth / cols / ((box.maxHeight - 16 * ((pcs.length / cols).ceil() - 1)) / (pcs.length / cols).ceil()),
          physics: const NeverScrollableScrollPhysics(),
          children: [for (final p in pcs) _PcTile(pc: p, selected: p['id'] == selected, onTap: onTap)],
        );
      }
      // mapX/mapY are 0..100 (% of the room); each tile is 14% wide.
      const w = 0.14, h = 0.2;
      return Stack(children: [
        for (final p in pcs)
          Positioned(
            left: ((p['mapX'] as num) / 100).clamp(0, 1 - w) * box.maxWidth,
            top: ((p['mapY'] as num) / 100).clamp(0, 1 - h) * box.maxHeight,
            width: box.maxWidth * w,
            height: box.maxHeight * h,
            child: _PcTile(pc: p, selected: p['id'] == selected, onTap: onTap),
          ),
      ]);
    });
  }
}

(Color, String) pcLook(String status) => switch (status) {
  'IDLE' => (Palette.green, 'Available'),
  'OFF' => (Palette.green, 'Available · off'),
  'IN_USE' => (Palette.teal, 'In use'),
  'MAINTENANCE' => (Palette.amber, 'Maintenance'),
  'OFFLINE' => (Palette.grey, 'Offline'),
  _ => (Palette.grey, 'Unavailable'),
};

class _PcTile extends StatelessWidget {
  const _PcTile({required this.pc, required this.selected, this.onTap});
  final dynamic pc;
  final bool selected;
  final ValueChanged<String>? onTap;
  @override
  Widget build(BuildContext context) {
    final status = pc['status'] as String;
    final (color, text) = pcLook(status);
    final free = availableStates.contains(status);
    return Material(
      color: selected ? color : color.withValues(alpha: free ? 0.12 : 0.08),
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: free && onTap != null ? () => onTap!(pc['id'] as String) : null,
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: selected ? Palette.navy : color.withValues(alpha: 0.6), width: selected ? 3 : 1.5),
          ),
          padding: const EdgeInsets.all(8),
          child: FittedBox(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Icon(free ? Icons.desktop_windows_outlined : Icons.desktop_access_disabled_outlined, size: 40, color: selected ? Colors.white : color),
              const SizedBox(height: 6),
              Text(pc['label'] as String, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: selected ? Colors.white : Palette.navy)),
              Text(text, style: TextStyle(fontSize: 14, color: selected ? Colors.white : Palette.muted)),
            ]),
          ),
        ),
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend();
  @override
  Widget build(BuildContext context) => Wrap(spacing: 24, children: [
    for (final s in ['IDLE', 'IN_USE', 'MAINTENANCE', 'OFFLINE'])
      Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.square_rounded, size: 16, color: pcLook(s).$1),
        const SizedBox(width: 6),
        Text(s == 'IDLE' ? 'Available' : pcLook(s).$2, style: const TextStyle(fontSize: 15, color: Palette.muted)),
      ]),
  ]);
}

// ============================================================ ACTIVE SESSION
class SessionScreen extends StatefulWidget {
  const SessionScreen({super.key, required this.api, required this.scanId, required this.student, required this.session, required this.cls});
  final KioskApi api;
  final String scanId;
  final Map<String, dynamic> student, session;
  final dynamic cls;
  @override
  State<SessionScreen> createState() => _SessionScreenState();
}

class _SessionScreenState extends State<SessionScreen> {
  bool _sending = false;

  Future<void> _end() async {
    setState(() => _sending = true);
    try {
      await widget.api.post('/sessions/${widget.session['id']}/end', {'scanId': widget.scanId});
      if (!mounted) return;
      await showKioskAlert(context, kind: AlertKind.success, title: 'Time-out recorded',
          message: 'Thank you, ${widget.student['name']}. Please log off and leave the PC tidy.', button: 'Done', autoClose: const Duration(seconds: 5));
    } on ApiError catch (e) {
      if (mounted) await showKioskAlert(context, kind: AlertKind.error, title: 'Could not end session', message: e.message);
    }
    if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
  }

  @override
  Widget build(BuildContext context) {
    final since = DateTime.parse(widget.session['timeIn'] as String).toLocal();
    final hhmm = TimeOfDay.fromDateTime(since).format(context);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 640),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Heading('Hi, ${widget.student['name']}', subtitle: 'You are using ${widget.session['workstationId']} since $hhmm.'),
                const SizedBox(height: 40),
                FilledButton.icon(
                  onPressed: _sending ? null : _end,
                  icon: const Icon(Icons.logout),
                  label: const Text('End session (time out)'),
                ),
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  onPressed: _sending
                      ? null
                      : () => Navigator.of(context).pushReplacement(MaterialPageRoute<void>(
                          builder: (_) => ReportScreen(api: widget.api, scanId: widget.scanId, student: widget.student, session: widget.session, pcs: const []))),
                  icon: const Icon(Icons.report_problem_outlined),
                  label: const Text('Report a problem with this PC'),
                ),
                const SizedBox(height: 16),
                TextButton(onPressed: () => Navigator.pop(context), child: const Text('Back', style: TextStyle(fontSize: 18))),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ============================================================ REPORT A PROBLEM
class ReportScreen extends StatefulWidget {
  const ReportScreen({super.key, required this.api, required this.scanId, required this.student, required this.session, required this.pcs});
  final KioskApi api;
  final String scanId;
  final Map<String, dynamic> student;
  final Map<String, dynamic>? session;
  final List<dynamic> pcs;
  @override
  State<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends State<ReportScreen> {
  static const presets = {
    'Won\'t turn on': 'power',
    'No display': 'hardware',
    'Keyboard / mouse': 'hardware',
    'No internet': 'network',
    'Software / app error': 'software',
    'Other': 'other',
  };
  String? _preset, _pc;
  final _details = TextEditingController();
  bool _endSession = true, _sending = false;

  @override
  void dispose() {
    _details.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final description = [_preset, _details.text.trim()].where((s) => s != null && s.isNotEmpty).join(': ');
    if (_preset == null) {
      return showKioskAlert(context, kind: AlertKind.warning, title: 'Choose a problem', message: 'Tap the button that best describes the problem.');
    }
    if (widget.session == null && _pc == null) {
      return showKioskAlert(context, kind: AlertKind.warning, title: 'Choose the PC', message: 'Tap which PC has the problem.');
    }
    setState(() => _sending = true);
    try {
      await widget.api.post('/issues/report', {
        'scanId': widget.scanId,
        if (widget.session != null) 'sessionId': widget.session!['id'],
        if (widget.session == null) 'workstationId': _pc,
        'category': presets[_preset],
        'description': description,
        if (widget.session != null) 'endSession': _endSession,
      });
      if (!mounted) return;
      await showKioskAlert(context, kind: AlertKind.success, title: 'Report sent',
          message: 'A technician has been notified.${_endSession && widget.session != null ? '\nYour session has ended. Scan again to choose another PC.' : ''}',
          button: 'Done', autoClose: const Duration(seconds: 6));
    } on ApiError catch (e) {
      if (mounted) await showKioskAlert(context, kind: AlertKind.error, title: 'Report not sent', message: e.message);
    }
    if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(32),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(children: [
              Expanded(child: Heading('Report a problem',
                  subtitle: widget.session != null ? 'PC ${widget.session!['workstationId']}' : 'Which PC and what happened?')),
              TextButton.icon(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close), label: const Text('Cancel', style: TextStyle(fontSize: 18))),
            ]),
            const SizedBox(height: 24),
            if (widget.session == null) ...[
              const Text('PC', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: Palette.navy)),
              const SizedBox(height: 10),
              Wrap(spacing: 12, runSpacing: 12, children: [
                for (final p in widget.pcs)
                  ChoiceChip(
                    label: Text(p['label'] as String, style: const TextStyle(fontSize: 18)),
                    padding: const EdgeInsets.all(12),
                    selected: _pc == p['id'],
                    onSelected: (_) => setState(() => _pc = p['id'] as String),
                  ),
              ]),
              const SizedBox(height: 24),
            ],
            const Text('Problem', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: Palette.navy)),
            const SizedBox(height: 10),
            Wrap(spacing: 12, runSpacing: 12, children: [
              for (final p in presets.keys)
                ChoiceChip(
                  label: Text(p, style: const TextStyle(fontSize: 18)),
                  padding: const EdgeInsets.all(12),
                  selected: _preset == p,
                  onSelected: (_) => setState(() => _preset = p),
                ),
            ]),
            const SizedBox(height: 24),
            TextField(controller: _details, maxLength: 300, maxLines: 2, style: const TextStyle(fontSize: 18),
                decoration: const InputDecoration(labelText: 'Details (optional)')),
            if (widget.session != null)
              SwitchListTile(
                value: _endSession,
                onChanged: (v) => setState(() => _endSession = v),
                title: const Text('End my session so I can move to another PC', style: TextStyle(fontSize: 18)),
              ),
            const SizedBox(height: 16),
            FilledButton.icon(onPressed: _sending ? null : _send, icon: const Icon(Icons.send), label: const Text('Send report')),
          ],
        ),
      ),
    ),
  );
}

// ============================================================ ONE-TIME SETUP
class SetupScreen extends StatefulWidget {
  const SetupScreen({super.key, required this.api, required this.onDone, this.canCancel = false});
  final KioskApi api;
  final VoidCallback onDone;
  final bool canCancel;
  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  late final _server = TextEditingController(text: widget.api.server);
  final _user = TextEditingController(text: 'admin'), _pass = TextEditingController();
  bool _sending = false;

  Future<void> _pair() async {
    setState(() => _sending = true);
    try {
      await widget.api.pair(_server.text, _user.text.trim(), _pass.text);
      if (!mounted) return;
      await showKioskAlert(context, kind: AlertKind.success, title: 'Tablet ready', message: 'This tablet is now the lab kiosk.', autoClose: const Duration(seconds: 3));
      widget.onDone();
    } on ApiError catch (e) {
      if (mounted) await showKioskAlert(context, kind: AlertKind.error, title: 'Setup failed', message: e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(32),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              const Heading('Kiosk setup', subtitle: 'An administrator signs in once to link this tablet to the lab server.'),
              const SizedBox(height: 28),
              TextField(controller: _server, keyboardType: TextInputType.url, decoration: const InputDecoration(labelText: 'Lab server address')),
              const SizedBox(height: 16),
              TextField(controller: _user, decoration: const InputDecoration(labelText: 'Admin username')),
              const SizedBox(height: 16),
              TextField(controller: _pass, obscureText: true, decoration: const InputDecoration(labelText: 'Admin password'), onSubmitted: (_) => _pair()),
              const SizedBox(height: 24),
              FilledButton(onPressed: _sending ? null : _pair, child: Text(_sending ? 'Connecting…' : 'Set up this tablet')),
              if (widget.canCancel) TextButton(onPressed: widget.onDone, child: const Text('Cancel')),
            ]),
          ),
        ),
      ),
    ),
  );
}
