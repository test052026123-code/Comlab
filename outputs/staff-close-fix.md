# Staff close dialog fix — 2026-11-11

The installed tablet app showed Flutter's `_dependents.isEmpty` assertion after
confirming a staff closure. Bryan's PC-01 session was still active when checked
after signing back in.

A regression test reproduced a preceding error in the local source:
`A TextEditingController was used after being disposed` in the staff reason
dialog. The dialog disposed controllers immediately after Navigator.pop, while
its fields could still rebuild during route exit.

The shared staff close/reassign form now uses TextFormField-owned controllers,
captures entered values with onChanged, unfocuses before closing, and checks
mounted after awaiting the dialog. Existing server safeguards are unchanged.

Validation: three new tests passed for submit, cancel, and a server-rejected
closure while the reason field has keyboard focus. Six existing workstation
and student dialog tests also passed. Analysis of the changed source and test
reported no issues.

The current D:\ComLab Android build configuration was synchronized with the
supplied comlab-45f0c registration. Its prior local copy still targeted the old
project; the installed tablet build 18 already contained comlab-45f0c.

Installation blocker: build 18's signing certificate differs from this
computer's debug certificate. The original signing key is required for an
in-place update. The installed app has not been uninstalled or had data cleared.

Build 19 completed successfully. Artifact:
`build/app/outputs/flutter-apk/ComLab-Dialog-Fix-build19.apk`.
Old Flutter generated caches were preserved under server/.local before
regeneration. Kotlin incremental compilation is disabled in the Android Gradle
properties to avoid cache failures in this Windows checkout. APK signing
verification passed. The package remains com.comlab.kiosk. Build 19 has not
been installed; the tablet remains on build 18.

Session blocker: the local backend's closeDecision rejects active sessions with
unknown power commands. The previous startup command remains unresolved. This
UI fix does not mark a power result successful or forcibly release the session.
