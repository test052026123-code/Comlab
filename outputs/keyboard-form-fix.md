# Tablet keyboard form layout — 2026-11-11

The live Register student dialog reduced its editable viewport to roughly
31 physical pixels while the landscape tablet keyboard was open. The dialog's
title, separate bottom actions, and standard insets consumed the usable height.

Student and workstation editors now share FormDialog. With the keyboard open,
the title and Save/Cancel controls occupy one header row, outer insets shrink,
and field padding becomes more compact. Text remains normal sized, the form
scrolls, and typed values remain in their existing state-owned controllers.
The normal keyboard-closed dialog layout is retained.

All 56 Flutter tests passed. Two new tests simulate the tablet at 1280×800,
240 dpi, system bars, and a 400-pixel keyboard. They verify an editable viewport
over 100 logical pixels, readable input text, reachable lower fields, visible
Save/Cancel controls, preservation of typed values, and safe cancellation.
Focused analysis reported no issues. Build 22 completed and passed APK signing
verification. Artifact: build/app/outputs/flutter-apk/ComLab-Keyboard-Forms-build22.apk.

Live inspection of build 22 revealed an additional focus regression: the
conditional Theme wrapper replaced the EditableText state as keyboard insets
changed, making the keyboard immediately dismiss. The regression test was
strengthened to assert identical EditableTextState and retained focus across
keyboard opening, closing, and reopening. It failed before the correction and
passes after making the content Theme wrapper permanent.

Build 23 supersedes build 22. The normal and keyboard layouts now use the same
field subtree. Existing text controllers remain owned by the editor state.

Build 23 was built, signature-verified, and installed as an in-place update.
All 56 Flutter tests passed and focused analysis reported no issues. Live tablet
inspection confirmed the keyboard remained shown and the input retained focus.
Save and Cancel occupied the header at physical y=48–120; the editable viewport
extended approximately y=132–376 above the keyboard at y=400, showing multiple
readable fields. The original failing viewport was approximately y=180–211.
The blank registration form was left open for the user; no student was saved.
Current artifact: build/app/outputs/flutter-apk/ComLab-Keyboard-Focus-build23.apk.
