# Report a problem and end session

Implemented on 2026-11-11. This change requires both the updated trusted API
and the updated Android app. Editing Firestore directly is not required for
normal report submission. No live deployment or tablet installation is implied.

The button is available during startup, on the session screen, and on the
welcome screen when an operation is still pending. Submitting the description
saves one issue and closes the session in the same Firestore transaction. It
clears only the matching active student and workstation links and holds the PC
under maintenance for staff inspection. A report does not shut the computer off.

The actual power-command result remains unchanged. Undelivered cloud queue
entries are removed; a relay pulse already accepted by hardware cannot be
recalled. A reported workstation remains unavailable until inspected by staff.

Retrying after a timeout uses the session ID as the issue ID, preventing duplicate
reports and protecting any newer assignment. The tablet clears its local pending
operation only after the server confirms sessionClosed=true. Network errors and
an older server response retain the saved operation.

If a session was manually deleted, the server can reconstruct a closed history
record from a matching command, exactly one active-student link, the student
record, and the matching workstation link. A different kiosk, missing evidence,
or inconsistent assignment is refused. Cross-kiosk reporting of a normal
session still requires fresh fingerprint proof; the creating kiosk can report
its own startup failure after its original scan expires.

Existing rollout blockers: the tablet's build 18 signing key is required for an
in-place update; the server change must be deployed to Render. Do not uninstall
the current app or clear its data as a substitute for reconciling cloud records.

Validation completed: 47 API tests and 53 Flutter tests passed. The report-flow
tests exercise the tablet's 240-dpi display and system-bar padding. Focused
analysis reported no issues. Build 20 completed and APK signature verification
passed. Artifact: `build/app/outputs/flutter-apk/ComLab-Report-End-build20.apk`.
The API change is also available in `outputs/report-and-close-api.patch`.
The tablet remains on build 18; neither this APK nor the API has been deployed.
