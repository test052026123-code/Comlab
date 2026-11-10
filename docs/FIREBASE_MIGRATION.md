# New Firebase project and hybrid storage

Target project: `comlab-45f0c`. Firebase Authentication remains the login provider.
The tablet's ignored `config/firebase.json` uses the Android registration for
`com.comlab.kiosk`; the GitHub Pages admin uses the project's web registration.
No server identity belongs in either client configuration.

## Storage ownership

- Firestore owns account approvals, student/slot links, workstations, attendance,
  sessions, cancellation tombstones, command queues/results, and audit records.
  Reservation and command creation remain one Firestore transaction.
- Realtime Database owns authenticated live telemetry at
  `controllerTelemetry/{controllerId}`. Original sample times, current sequence,
  digest, and permanently retained boot IDs protect freshness and replay checks.
- Both databases deny direct client access. Only the trusted API's Admin SDK
  accesses them. ESP32 boards continue to use the existing HTTPS API protocol.

## Idle heartbeat optimization

The API listens for pending Firestore commands, waiting scans, pending bench
tests, and scanner capacity. Until all initial listener snapshots arrive, or
after a listener error, it uses the original durable exchange. Results, scan
progress, and changed sensor capacity always use that exchange too.

An idle heartbeat updates only Realtime Database. Every new controller boot must
first pass the original Firestore boot/command recovery transaction before idle
replies become possible. A new queued action is dispatched after its listener
notification arrives; command expiry is unchanged. Duplicate telemetry never
refreshes status and retired boots cannot become current again. Durable command
transactions and physical pulse deduplication have not moved across databases.

PC status refreshes every 15 seconds. Full admin records refresh every minute,
after a mutation, or on manual refresh. API role approval checks remain live.
This reduces traffic but does not make either database quota-free. Pending or
unresolved work still uses Firestore; investigate it rather than deleting journals.

## Deployment and remaining migration

Render needs the new project's private `firebase-admin.json` secret and
`GOOGLE_CLOUD_PROJECT=comlab-45f0c`. Set `FIREBASE_DATABASE_URL` to the new database
URL in `server/RENDER_SETUP.md`. For this project that URL also defaults in code;
other projects must configure it explicitly. Deploy the API and GitHub Pages
client together, then install the new-project tablet APK and sign in again.

Provisioned new-project accounts: administrator and kiosk supplied by the owner.
Private Firestore and Realtime Database rules were deployed during preparation.
The new project was confirmed to contain zero students and zero workstations.
Old project records have not been copied. Preserve the old database; export and
review roster, slot mappings and history when access is available. Do not copy
active commands or replay hardware work into the new project. Reconcile old
assignments and device journals before enabling physical power operations.

If the APK signing certificate differs from the installed build, stop before
uninstalling: uninstalling erases local credentials/settings and recovery IDs.
Keep the built APK available and resolve signing or obtain explicit approval
for replacement installation.

## Verification

Server tests cover boot checkpointing, retired/replayed/conflicting telemetry,
duplicate freshness, stale node rejection, and fail-closed work monitoring.
An isolated live RTDB test exercised real compare-and-set transactions and
empty-array serialization, then removed its temporary path. It did not target
the controller or send relay commands. Physical acceptance remains required.
