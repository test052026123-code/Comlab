import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import '../core/contracts.dart';
import '../core/lab_state.dart';
import 'widgets.dart';
import 'student_editor.dart';
import 'workstation_editor.dart';
import 'relay_test.dart';
import 'fingerprint_enroll.dart';

class AdminData extends ChangeNotifier {
  AdminData(this.lab);
  bool disposed = false;
  @override
  void dispose() {
    disposed = true;
    super.dispose();
  }

  final LabState lab;
  int tab = 0;
  bool loading = true, stale = false;
  String? error;
  List<Json> students = [],
      workstations = [],
      history = [],
      allHistory = [],
      issues = [],
      audit = [];
  String studentFilter = '',
      pcFilter = '',
      sectionFilter = '',
      from = '',
      to = '';
  String get query =>
      '?${Uri(queryParameters: {if (studentFilter.isNotEmpty) 'student': studentFilter, if (pcFilter.isNotEmpty) 'pc': pcFilter, if (sectionFilter.isNotEmpty) 'section': sectionFilter, if (from.isNotEmpty) 'from': from, if (to.isNotEmpty) 'to': to}).query}';
  Future<void> load({bool statusOnly = false}) async {
    if (!lab.admin || disposed) return;
    loading = true;
    if (!statusOnly) error = null;
    notifyListeners();
    try {
      final repo = lab.repository;
      if (statusOnly) {
        final result = await repo.get('/workstations');
        if (disposed) return;
        workstations = (result['workstations'] as List).cast<Json>();
        if (result['controllerError'] != null) {
          error = result['controllerError'] as String;
        }
        loading = false;
        notifyListeners();
        return;
      }
      final results = await Future.wait([
        repo.get('/admin/students'),
        repo.get('/workstations'),
        repo.get('/admin/history$query'),
        repo.get('/admin/issues'),
        repo.get('/admin/audit'),
        repo.get('/admin/history'),
      ]);
      if (disposed) return;
      students = (results[0]['rows'] as List).cast<Json>();
      workstations = (results[1]['workstations'] as List).cast<Json>();
      history = (results[2]['rows'] as List).cast<Json>();
      issues = (results[3]['rows'] as List).cast<Json>();
      audit = (results[4]['rows'] as List).cast<Json>();
      allHistory = (results[5]['rows'] as List).cast<Json>();
      stale = false;
      if (results[1]['controllerError'] != null) {
        error = results[1]['controllerError'] as String;
      }
    } catch (e) {
      error = '$e';
      stale = true;
    }
    if (disposed) return;
    loading = false;
    notifyListeners();
  }

  void select(int value) {
    tab = value;
    notifyListeners();
  }
}

class AdminScreen extends StatefulWidget {
  const AdminScreen({super.key, required this.state});
  final LabState state;
  @override
  State<AdminScreen> createState() => _AdminScreenState();
}

class _AdminScreenState extends State<AdminScreen> {
  late final AdminData data;
  Timer? refresh;
  String search = '';
  static const tabs = [
    'Overview',
    'Students',
    'Workstations',
    'Attendance',
    'Issues',
    'Audit',
  ];
  static const icons = [
    Icons.dashboard_outlined,
    Icons.people_outline,
    Icons.computer,
    Icons.history,
    Icons.build_outlined,
    Icons.policy_outlined,
  ];
  @override
  void initState() {
    super.initState();
    data = AdminData(widget.state);
    data.load();
    refresh = Timer.periodic(const Duration(seconds: 15), (timer) {
      if (!data.loading && !widget.state.busy) {
        data.load(statusOnly: timer.tick % 4 != 0);
      }
    });
  }

  @override
  void dispose() {
    refresh?.cancel();
    data.dispose();
    super.dispose();
  }

  Future<void> save(String path, Json body) async {
    await widget.state.repository.put(path, body);
    await data.load();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.state.admin) {
      return const Center(
        child: Text('Administrator authentication required.'),
      );
    }
    return ListenableBuilder(
      listenable: data,
      builder: (context, _) => LayoutBuilder(
        builder: (context, box) {
          final navigation = box.maxWidth >= 900
              ? NavigationRail(
                  selectedIndex: data.tab,
                  labelType: NavigationRailLabelType.all,
                  onDestinationSelected: data.select,
                  destinations: List.generate(
                    tabs.length,
                    (i) => NavigationRailDestination(
                      icon: Icon(icons[i]),
                      label: Text(tabs[i]),
                    ),
                  ),
                )
              : null;
          final content = Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 18, 24, 0),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        tabs[data.tab],
                        style: const TextStyle(
                          fontSize: 27,
                          fontWeight: FontWeight.w800,
                          color: navy,
                        ),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Refresh',
                      onPressed: data.loading ? null : data.load,
                      icon: const Icon(Icons.refresh),
                    ),
                    IconButton(
                      tooltip: 'Settings and diagnostics',
                      onPressed: () => widget.state.navigate('settings'),
                      icon: const Icon(Icons.settings_outlined),
                    ),
                  ],
                ),
              ),
              if (data.loading) const LinearProgressIndicator(),
              if (data.error != null)
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Notice(
                    '${data.stale ? 'Stale / read-only. ' : ''}${data.error}',
                    error: true,
                  ),
                ),
              Expanded(
                child: AbsorbPointer(
                  absorbing: data.stale || widget.state.busy,
                  child: _body(),
                ),
              ),
              if (navigation == null)
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: List.generate(
                      tabs.length,
                      (i) => Padding(
                        padding: const EdgeInsets.all(4),
                        child: ChoiceChip(
                          selected: data.tab == i,
                          label: Text(tabs[i]),
                          onSelected: (_) => data.select(i),
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          );
          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ?navigation,
              Expanded(child: content),
            ],
          );
        },
      ),
    );
  }

  Widget _body() => switch (data.tab) {
    1 => _students(),
    2 => _pcs(),
    3 => _history(),
    4 => _issues(),
    5 => _audit(),
    _ => _overview(),
  };
  Widget _list(List<Widget> children) =>
      ListView(padding: const EdgeInsets.all(24), children: children);
  Widget _overview() {
    final sessions = data.allHistory
        .where((s) => s['status'] == 'active')
        .toList();
    final today = DateTime.now()
        .toUtc()
        .add(const Duration(hours: 8))
        .toIso8601String()
        .substring(0, 10);
    final checked = data.allHistory
        .where(
          (s) => DateTime.parse(s['timeIn'] as String)
              .toUtc()
              .add(const Duration(hours: 8))
              .toIso8601String()
              .startsWith(today),
        )
        .length;
    return _list([
      titleBlock(
        'Laboratory at a glance',
        'PC status every 15 seconds • Records every minute • Dates in Philippine time',
      ),
      Wrap(
        spacing: 16,
        runSpacing: 16,
        children: [
          for (final m in {
            'Registered students': data.students.length,
            'Workstations': data.workstations.length,
            'Active sessions': sessions.length,
            'Today’s check-ins': checked,
            'Disconnected / stale': data.workstations
                .where((p) => p['node']?['connectivity'] != 'connected')
                .length,
          }.entries)
            SizedBox(
              width: 190,
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(22),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${m.value}',
                        style: const TextStyle(
                          fontSize: 36,
                          fontWeight: FontWeight.w800,
                          color: teal,
                        ),
                      ),
                      Text(m.key),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
      const SizedBox(height: 28),
      titleBlock(
        'Current assignments',
        'Select a session to inspect or take a staff action.',
      ),
      if (sessions.isEmpty)
        const Notice(
          'No active sessions. Check-ins will appear here after they commit to Firebase.',
        ),
      ...sessions.map(_sessionTile),
    ]);
  }

  Widget _sessionTile(Json s) => Card(
    child: ListTile(
      contentPadding: const EdgeInsets.all(16),
      leading: const Icon(Icons.desktop_windows, color: teal),
      title: Text('${s['workstationId']} • ${s['name']}'),
      subtitle: Text(
        '${s['studentId']} • ${s['section']} • ${s['status']}\n${displayTime(s['timeIn'])}',
      ),
      isThreeLine: true,
      trailing: const Icon(Icons.chevron_right),
      onTap: () => _sessionDetails(s),
    ),
  );
  Widget _students() => _list([
    Row(
      children: [
        Expanded(
          child: TextField(
            decoration: const InputDecoration(
              labelText: 'Search student ID, name or section',
              prefixIcon: Icon(Icons.search),
            ),
            onChanged: (v) => setState(() => search = v.toLowerCase()),
          ),
        ),
        const SizedBox(width: 16),
        action(
          'Add student',
          () => _studentEditor(),
          icon: Icons.person_add_outlined,
        ),
      ],
    ),
    const SizedBox(height: 20),
    if (data.students.isEmpty)
      const Notice(
        'No students registered. Add real student records to enable kiosk check-in.',
      ),
    ...data.students
        .where(
          (s) => '${s['id']} ${s['name']} ${s['section']}'
              .toLowerCase()
              .contains(search),
        )
        .map(
          (s) => Card(
            child: ListTile(
              contentPadding: const EdgeInsets.all(14),
              leading: Icon(
                s['active'] == true
                    ? Icons.person_outline
                    : Icons.person_off_outlined,
              ),
              title: Text('${s['name']}'),
              subtitle: Text(
                '${s['id']} • ${s['section']} • ${s['active'] == true ? 'Active' : 'Inactive'} • '
                '${s['fingerprintSlot'] == null ? 'No fingerprint' : 'Fingerprint slot ${s['fingerprintSlot']}'}',
              ),
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    tooltip: 'Enroll fingerprint',
                    icon: const Icon(Icons.fingerprint),
                    onPressed: data.stale || widget.state.busy
                        ? null
                        : () => _enroll(s),
                  ),
                  const Icon(Icons.edit_outlined),
                ],
              ),
              onTap: () => _studentEditor(s),
            ),
          ),
        ),
  ]);
  Future<void> _enroll(Json s) async {
    final enrolled = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => FingerprintEnrollDialog(
        repository: widget.state.repository,
        student: s,
      ),
    );
    if (mounted && enrolled == true) await data.load();
  }

  Future<void> _studentEditor([Json? s]) async {
    final values = await showDialog<Json>(
      context: context,
      builder: (_) => StudentEditorDialog(student: s),
    );
    if (!mounted) return;
    if (values != null) {
      await widget.state.run(() async {
        final key = widget.state.identification.normalize(
          values.remove('id') as String,
        );
        // Creation has a distinct endpoint to prevent overwriting an existing ID.
        if (s == null) {
          await widget.state.repository.post('/admin/students', {
            'id': key,
            ...values,
          });
          await data.load();
        } else {
          await save('/admin/students/$key', values);
        }
      });
    }
  }

  Widget _pcs() => _list([
    action('Create workstation', () => _pcEditor(), icon: Icons.add),
    const SizedBox(height: 20),
    const Notice(
      'Map order follows PC numbers; arrange the physical desks accordingly. Node connectivity and power feedback are independent of assignment.',
    ),
    Wrap(
      spacing: 16,
      runSpacing: 16,
      children: data.workstations
          .map(
            (p) => SizedBox(
              width: 240,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  PcCard(pc: p, admin: true, onTap: () => _pcEditor(p)),
                  TextButton.icon(
                    onPressed:
                        data.stale ||
                            widget.state.busy ||
                            p['sessionId'] != null
                        ? null
                        : () => showDialog<void>(
                            context: context,
                            builder: (_) => RelayTestDialog(
                              repository: widget.state.repository,
                              pc: p,
                            ),
                          ),
                    icon: const Icon(Icons.electrical_services_outlined),
                    label: const Text('Test node relay'),
                  ),
                ],
              ),
            ),
          )
          .toList(),
    ),
  ]);
  Future<void> _pcEditor([Json? p]) async {
    final assigned = data.allHistory
        .where((s) => s['id'] == p?['sessionId'])
        .firstOrNull;
    final values = await showDialog<Json>(
      context: context,
      builder: (_) =>
          WorkstationEditorDialog(workstation: p, assigned: assigned),
    );
    if (!mounted) return;
    if (values != null) {
      await widget.state.run(() async {
        final key = values.remove('id');
        await save('/admin/workstations/$key', values);
      });
    }
  }

  Widget _history() => _list([
    const Notice(
      'Filters apply to attendance and exported CSV. Dates use Philippine time (YYYY-MM-DD).',
    ),
    Wrap(
      spacing: 12,
      runSpacing: 12,
      children: [
        for (final f in [
          (
            'Student ID',
            data.studentFilter,
            (String v) => data.studentFilter = v,
          ),
          ('PC ID', data.pcFilter, (String v) => data.pcFilter = v),
          ('Section', data.sectionFilter, (String v) => data.sectionFilter = v),
          ('From date', data.from, (String v) => data.from = v),
          ('Through date', data.to, (String v) => data.to = v),
        ])
          SizedBox(
            width: 175,
            child: TextFormField(
              initialValue: f.$2,
              decoration: InputDecoration(labelText: f.$1),
              onChanged: f.$3,
            ),
          ),
        action('Apply', data.load, icon: Icons.filter_list),
        action(
          'Export CSV',
          () => widget.state.run(() async {
            final csv = await widget.state.repository.exportCsv(data.query);
            await SharePlus.instance.share(
              ShareParams(
                files: [
                  XFile.fromData(
                    Uint8List.fromList(utf8.encode(csv)),
                    mimeType: 'text/csv',
                  ),
                ],
                fileNameOverrides: ['comlab-attendance.csv'],
              ),
            );
          }),
          icon: Icons.download_outlined,
        ),
      ],
    ),
    const SizedBox(height: 20),
    if (data.history.isEmpty)
      const Notice('No attendance matches these filters.'),
    ...data.history.map(_sessionTile),
  ]);
  Future<void> _sessionDetails(Json s) async {
    final option = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('${s['workstationId']} • ${s['name']}'),
        content: SelectableText(
          'Student: ${s['studentId']}\nSection: ${s['section']}\nSession: ${s['id']}\nStatus: ${s['status']}\nIn: ${displayTime(s['timeIn'])}\nOut: ${displayTime(s['timeOut'])}\nReason: ${s['closeReason'] ?? '—'}',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Back'),
          ),
          if (s['status'] == 'active') ...[
            TextButton(
              onPressed: () => Navigator.pop(context, 'reconcile'),
              child: const Text('Reconcile power'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context, 'reassign'),
              child: const Text('Reassign'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, 'close'),
              child: const Text('Staff close'),
            ),
          ],
        ],
      ),
    );
    if (option == null || !mounted) return;
    if (option == 'reconcile') {
      await widget.state.run(() async {
        await widget.state.repository.post(
          '/operations/${s['id']}/reconcile',
          {},
        );
        await data.load();
      });
      return;
    }
    final reason = TextEditingController(), pc = TextEditingController();
    final values = await showDialog<Json>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          option == 'reassign'
              ? 'Reassign with reason'
              : 'Staff close with reason',
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (option == 'reassign')
              TextField(
                controller: pc,
                decoration: const InputDecoration(labelText: 'New PC ID'),
              ),
            const SizedBox(height: 16),
            TextField(
              controller: reason,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Required reason'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, {
              'pc': pc.text.trim().toUpperCase(),
              'reason': reason.text.trim(),
            }),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    reason.dispose();
    pc.dispose();
    if (values != null) {
      await widget.state.run(() async {
        if (option == 'reassign') {
          await widget.state.reassign(
            s,
            values['pc'] as String,
            values['reason'] as String,
          );
        } else {
          await widget.state.repository.post('/sessions/${s['id']}/close', {
            'reason': values['reason'],
          });
          await data.load();
        }
      });
    }
  }

  Widget _issues() => _list([
    if (data.issues.isEmpty) const Notice('No issue reports.'),
    ...data.issues.map(
      (i) => Card(
        child: ListTile(
          contentPadding: const EdgeInsets.all(16),
          leading: const Icon(Icons.build_outlined),
          title: Text('${i['workstationId']} • ${i['status']}'),
          subtitle: Text(
            '${i['description']}\n${i['studentId']} • ${displayTime(i['at'])}',
          ),
          isThreeLine: true,
          onTap: () => _issueEditor(i),
        ),
      ),
    ),
  ]);
  Future<void> _issueEditor(Json i) async {
    final remarks = TextEditingController(text: i['remarks'] as String?),
        resolution = TextEditingController(text: i['resolution'] as String?);
    String status = i['status'] as String;
    final values = await showDialog<Json>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, set) => AlertDialog(
          title: const Text('Issue management'),
          content: SizedBox(
            width: 500,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('${i['description']}'),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    initialValue: status,
                    items: ['open', 'investigating', 'resolved']
                        .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                        .toList(),
                    onChanged: (s) => set(() => status = s!),
                    decoration: const InputDecoration(labelText: 'Status'),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: remarks,
                    maxLines: 3,
                    decoration: const InputDecoration(
                      labelText: 'Technician remarks',
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: resolution,
                    maxLines: 3,
                    decoration: const InputDecoration(
                      labelText: 'Resolution (required to resolve)',
                    ),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, {
                'status': status,
                'remarks': remarks.text,
                'resolution': resolution.text,
              }),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    remarks.dispose();
    resolution.dispose();
    if (values != null) {
      await widget.state.run(() => save('/admin/issues/${i['id']}', values));
    }
  }

  Widget _audit() => _list([
    const Notice(
      'Append-only records created by the trusted API and provisioning CLI. Mobile clients cannot modify audit history.',
    ),
    if (data.audit.isEmpty) const Text('No audit records yet.'),
    ...data.audit.map(
      (a) => Card(
        child: ListTile(
          contentPadding: const EdgeInsets.all(16),
          title: Text('${a['action']} • ${displayTime(a['at'])}'),
          subtitle: SelectableText(
            'Actor: ${a['actor']}\n${jsonEncode(a['data'])}',
          ),
        ),
      ),
    ),
  ]);
}
