import 'package:flutter/material.dart';
import '../core/lab_state.dart';
import 'lab_artwork.dart';
import 'widgets.dart';

class WelcomeScreen extends StatefulWidget {
  const WelcomeScreen({super.key, required this.state});
  final LabState state;
  @override
  State<WelcomeScreen> createState() => _WelcomeScreenState();
}

class _WelcomeScreenState extends State<WelcomeScreen> {
  final input = TextEditingController();
  final focus = FocusNode();
  bool checkout = false;

  @override
  void dispose() {
    input.dispose();
    focus.dispose();
    super.dispose();
  }

  void type(String key) {
    final value = input.value;
    final start = value.selection.isValid
        ? value.selection.start
        : value.text.length;
    final end = value.selection.isValid
        ? value.selection.end
        : value.text.length;
    if (key == 'Clear') {
      input.clear();
    } else if (key == 'Backspace') {
      final from = start == end ? (start > 0 ? start - 1 : 0) : start;
      input.value = TextEditingValue(
        text: value.text.replaceRange(from, end, ''),
        selection: TextSelection.collapsed(offset: from),
      );
    } else if (value.text.length - (end - start) < 40) {
      input.value = TextEditingValue(
        text: value.text.replaceRange(start, end, key),
        selection: TextSelection.collapsed(offset: start + key.length),
      );
    }
  }

  Future<void> submit() async {
    final id = input.text;
    focus.unfocus();
    await widget.state.run(() => widget.state.lookup(id));
  }

  bool letters = false;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) {
      final landscape = box.maxWidth >= 700 && box.maxWidth > box.maxHeight;
      final compact = box.maxHeight < 650;
      final s = widget.state;
      final keyboardVisible = letters && View.of(context).viewInsets.bottom > 0;
      if (keyboardVisible) {
        return Padding(
          padding: const EdgeInsets.all(8),
          child: _entry(s, true, keyboardVisible: true),
        );
      }
      final intro = _intro(s, landscape, compact);
      final entry = _entry(s, compact);
      return Padding(
        padding: EdgeInsets.all(
          box.maxHeight < 430
              ? 6
              : compact
              ? 12
              : 24,
        ),
        child: landscape
            ? Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(flex: 10, child: intro),
                  SizedBox(width: compact ? 24 : 36),
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
          'Enter your student ID to check in and choose a computer.',
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
            'Temporary ID entry does not verify identity. Attendance is recorded after PC confirmation.',
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

  Widget _entry(LabState s, bool compact, {bool keyboardVisible = false}) {
    return LayoutBuilder(
      builder: (context, bounds) {
        if (keyboardVisible && bounds.maxHeight < 190) {
          return Container(
            padding: const EdgeInsets.all(4),
            color: Colors.white,
            child: Row(
              children: [
                Expanded(
                  child: SizedBox(
                    height: 44,
                    child: TextField(
                      key: const ValueKey('student-id-entry'),
                      controller: input,
                      focusNode: focus,
                      enabled: !s.busy && s.pending == null,
                      keyboardType: TextInputType.text,
                      textCapitalization: TextCapitalization.characters,
                      maxLength: 40,
                      decoration: InputDecoration(
                        labelText: 'Student ID',
                        counterText: '',
                        isDense: true,
                        contentPadding: const EdgeInsets.all(10),
                        suffixIcon: IconButton(
                          tooltip: 'Use numeric keypad',
                          icon: const Icon(Icons.dialpad, size: 20),
                          onPressed: () {
                            focus.unfocus();
                            setState(() => letters = false);
                          },
                        ),
                      ),
                      onSubmitted: (_) => submit(),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  height: 44,
                  child: FilledButton(
                    key: const ValueKey('continue-button'),
                    style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                    ),
                    onPressed: s.busy || s.pending != null ? null : submit,
                    child: Text(checkout ? 'Find my session' : 'Continue'),
                  ),
                ),
              ],
            ),
          );
        }
        if (!keyboardVisible && bounds.maxHeight < 410) return _shortEntry(s);
        return _regularEntry(s, compact, keyboardVisible: keyboardVisible);
      },
    );
  }

  Widget _shortEntry(LabState s) {
    final locked = s.busy || s.pending != null;
    return Container(
      key: const ValueKey('check-in-panel'),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFF0EAE5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            checkout ? 'Find your session' : 'Student Check-in',
            style: const TextStyle(
              fontSize: 22,
              height: 1.1,
              fontWeight: FontWeight.w900,
              color: navy,
            ),
          ),
          const SizedBox(height: 6),
          SizedBox(
            height: 42,
            child: TextField(
              key: const ValueKey('student-id-entry'),
              controller: input,
              focusNode: focus,
              enabled: !locked,
              maxLength: 40,
              keyboardType: TextInputType.none,
              textCapitalization: TextCapitalization.characters,
              style: const TextStyle(fontSize: 18, height: 1.1, color: navy),
              decoration: InputDecoration(
                labelText: 'Student ID',
                hintText: 'Enter student ID',
                floatingLabelBehavior: FloatingLabelBehavior.always,
                counterText: '',
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 9,
                ),
                suffixIcon: IconButton(
                  tooltip: 'Use letters or symbols',
                  padding: EdgeInsets.zero,
                  icon: const Icon(Icons.keyboard_outlined, size: 20),
                  onPressed: locked
                      ? null
                      : () {
                          focus.unfocus();
                          setState(() => letters = true);
                          WidgetsBinding.instance.addPostFrameCallback((_) {
                            if (mounted) focus.requestFocus();
                          });
                        },
                ),
                enabledBorder: const OutlineInputBorder(
                  borderSide: BorderSide(color: teal, width: 2),
                  borderRadius: BorderRadius.all(Radius.circular(10)),
                ),
              ),
              onSubmitted: (_) => submit(),
            ),
          ),
          const SizedBox(height: 8),
          if (s.pending != null) ...[
            const Expanded(
              child: Center(
                child: Notice(
                  'A previous operation needs reconciliation. Its PC remains reserved.',
                ),
              ),
            ),
            FilledButton.icon(
              onPressed: s.busy ? null : () => s.run(s.recover),
              icon: const Icon(Icons.sync),
              label: const Text('Recover pending operation'),
            ),
          ] else ...[
            Expanded(
              child: Column(
                children: [
                  for (var row = 0; row < 4; row++) ...[
                    if (row > 0) const SizedBox(height: 4),
                    Expanded(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          for (var col = 0; col < 3; col++) ...[
                            if (col > 0) const SizedBox(width: 8),
                            Expanded(
                              child: _key(
                                [
                                  '1',
                                  '2',
                                  '3',
                                  '4',
                                  '5',
                                  '6',
                                  '7',
                                  '8',
                                  '9',
                                  'Clear',
                                  '0',
                                  'Backspace',
                                ][row * 3 + col],
                                locked,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 8),
            SizedBox(
              height: 40,
              child: FilledButton(
                key: const ValueKey('continue-button'),
                style: FilledButton.styleFrom(padding: EdgeInsets.zero),
                onPressed: locked ? null : submit,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      checkout ? 'Find my session' : 'Continue',
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(width: 10),
                    const Icon(Icons.arrow_forward, size: 20),
                  ],
                ),
              ),
            ),
            SizedBox(
              height: 28,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Flexible(
                    child: Text(
                      checkout ? 'Ready to check in?' : 'Already checked in?',
                      style: const TextStyle(
                        fontSize: 11,
                        color: Color(0xFF72768C),
                      ),
                    ),
                  ),
                  TextButton(
                    style: TextButton.styleFrom(
                      minimumSize: Size.zero,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    onPressed: locked
                        ? null
                        : () => setState(() => checkout = !checkout),
                    child: Text(
                      checkout ? 'Check In' : 'Check Out',
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _regularEntry(
    LabState s,
    bool compact, {
    bool keyboardVisible = false,
  }) {
    final locked = s.busy || s.pending != null;
    return Container(
      key: const ValueKey('check-in-panel'),
      padding: EdgeInsets.all(
        keyboardVisible
            ? 12
            : compact
            ? 16
            : 26,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFF0EAE5)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0D544132),
            blurRadius: 22,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (!keyboardVisible) ...[
            Text(
              checkout ? 'Find your session' : 'Student Check-in',
              maxLines: 1,
              style: TextStyle(
                fontSize: compact ? 26 : 32,
                height: 1.1,
                letterSpacing: -.7,
                fontWeight: FontWeight.w900,
                color: navy,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              checkout
                  ? 'Use your ID to view your active session.'
                  : 'Use your registered student ID.',
              style: TextStyle(
                fontSize: compact ? 14 : 16,
                color: const Color(0xFF72768C),
              ),
            ),
            const SizedBox(height: 8),
          ],
          Row(
            children: [
              const Text(
                'Student ID',
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 14,
                  color: navy,
                ),
              ),
              const Expanded(
                child: Text(
                  'Temporary ID entry',
                  textAlign: TextAlign.end,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: teal,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              SizedBox(
                width: 34,
                height: 30,
                child: IconButton(
                  padding: EdgeInsets.zero,
                  tooltip: letters
                      ? 'Use numeric keypad'
                      : 'Use letters or symbols',
                  onPressed: locked
                      ? null
                      : () {
                          focus.unfocus();
                          setState(() => letters = !letters);
                          if (letters) {
                            WidgetsBinding.instance.addPostFrameCallback((_) {
                              if (mounted) focus.requestFocus();
                            });
                          }
                        },
                  icon: Icon(
                    letters ? Icons.dialpad : Icons.keyboard_outlined,
                    size: 20,
                  ),
                ),
              ),
            ],
          ),
          SizedBox(
            height: compact ? 46 : 54,
            child: TextField(
              key: const ValueKey('student-id-entry'),
              controller: input,
              focusNode: focus,
              enabled: !locked,
              maxLength: 40,
              keyboardType: letters ? TextInputType.text : TextInputType.none,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(
                hintText: 'Enter student ID',
                counterText: '',
                isDense: true,
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 12,
                ),
                enabledBorder: OutlineInputBorder(
                  borderSide: BorderSide(color: teal, width: 2),
                  borderRadius: BorderRadius.all(Radius.circular(11)),
                ),
              ),
              style: const TextStyle(fontSize: 19, color: navy),
              onSubmitted: (_) => submit(),
            ),
          ),
          const SizedBox(height: 10),
          if (s.pending != null) ...[
            const Expanded(
              child: Center(
                child: Notice(
                  'A previous operation needs reconciliation. Its PC remains reserved.',
                ),
              ),
            ),
            FilledButton.icon(
              onPressed: s.busy ? null : () => s.run(s.recover),
              icon: const Icon(Icons.sync),
              label: const Text('Recover pending operation'),
            ),
          ] else ...[
            if (keyboardVisible)
              const Spacer()
            else
              Expanded(
                child: Column(
                  children: [
                    for (var row = 0; row < 4; row++) ...[
                      if (row > 0) const SizedBox(height: 6),
                      Expanded(
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            for (var col = 0; col < 3; col++) ...[
                              if (col > 0) const SizedBox(width: 8),
                              Expanded(
                                child: _key(
                                  [
                                    '1',
                                    '2',
                                    '3',
                                    '4',
                                    '5',
                                    '6',
                                    '7',
                                    '8',
                                    '9',
                                    'Clear',
                                    '0',
                                    'Backspace',
                                  ][row * 3 + col],
                                  locked,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            const SizedBox(height: 10),
            SizedBox(
              height: compact ? 44 : 52,
              child: FilledButton(
                key: const ValueKey('continue-button'),
                style: FilledButton.styleFrom(padding: EdgeInsets.zero),
                onPressed: locked ? null : submit,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      checkout ? 'Find my session' : 'Continue',
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(width: 12),
                    const Icon(Icons.arrow_forward),
                  ],
                ),
              ),
            ),
            if (!keyboardVisible)
              SizedBox(
                height: 34,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Flexible(
                      child: Text(
                        checkout ? 'Ready to check in?' : 'Already checked in?',
                        style: const TextStyle(
                          fontSize: 12,
                          color: Color(0xFF72768C),
                        ),
                      ),
                    ),
                    TextButton(
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        minimumSize: const Size(0, 30),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      onPressed: locked
                          ? null
                          : () => setState(() => checkout = !checkout),
                      child: Text(
                        checkout ? 'Check In' : 'Check Out',
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }

  Widget _key(String key, bool locked) => OutlinedButton(
    style: OutlinedButton.styleFrom(
      backgroundColor: const Color(0xFFFAF9F7),
      foregroundColor: navy,
      padding: EdgeInsets.zero,
      minimumSize: Size.zero,
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      side: const BorderSide(color: Color(0xFFDEDDDF)),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    ),
    onPressed: locked ? null : () => type(key),
    child: key == 'Backspace'
        ? const Icon(
            Icons.backspace_outlined,
            semanticLabel: 'Backspace',
            size: 23,
          )
        : Text(
            key,
            style: TextStyle(
              fontSize: key == 'Clear' ? 17 : 25,
              fontWeight: FontWeight.w800,
            ),
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
                      ['Enter ID', 'Choose PC', 'Start session'][i],
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
