# ComLab

Cloud migration: [Render setup](server/RENDER_SETUP.md) and
[outbound ESP32 protocol](docs/CLOUD_CONTROLLER_API.md). Cloud-mode server and
app changes are implemented and locally tested. Render origin
`https://comlab-api.onrender.com` passed HTTPS process-health and authentication-
guard checks; approved-user/Firebase access still needs verification. The new ESP32 sketch is connection-test firmware only,
reports zero nodes and never powers a PC. In cloud mode the ESP32 connects
outbound over trusted HTTPS; the Windows server and LAN DNS are unnecessary.
The original LAN operating instructions below still apply to LAN mode.

Android tablet laboratory-management prototype. Package: `com.comlab.kiosk`.
Current debug APK: [ComLab-Cloud-build10.apk](build/app/outputs/flutter-apk/ComLab-Cloud-build10.apk)
(version 1.0.0, build 10, configured for your ComLab Firebase Android registration).
Minimum Android 7 / API 24. Install over the earlier setup-only build to retain
settings. Firebase values are in the ignored local `config/firebase.json`;
server credentials are never included in the app.
The student interface follows the supplied cream, navy and teal reference:
offline vector lab artwork, an editable student-ID field with numeric keypad,
check-in / session lookup, a three-step footer, and selectable workstation cards.
Availability counts come from fetched backend records; unqueried counts show a dash.
Unavailable PCs and stale status cannot be confirmed. Check-in and PC selection
use fixed tablet layouts without page scrolling. The keypad fits the available
height; all five PC cards and the confirmation bar stay visible. Numeric entry
keeps the system keyboard hidden; the keyboard button enables letters/symbols
with a compact input layout while that keyboard is open.
Short tablet windows use a condensed check-in form to preserve readable keypad
rows; validation includes the U24 Pro's 240-dpi display and Android system bars.
Student request failures appear under **View error** in the header, preserving
keypad/card height. If a temporary tunnel stops, start a new one and enter its
actual verified origin in **Admin Login → Trusted API HTTPS address**. The new
address is saved only after administrator role approval, connection-settings
audit, and local secure-storage success; failed sign-in retains the old address.
This is an independent project in `C:\Users\clima\Desktop\ComLab`; it does not
use eSURSECO's Firebase project, `.env`, API, or deployment configuration.

## Architecture and operating requirements

Flutter / Material 3 uses ChangeNotifier for application state. Identification,
storage, private persistence and device transport have separate interfaces in
`lib/core/contracts.dart`. Replace `StudentIdIdentification` for AS608 input and
`LabRepository` for a future Orange Pi service. File transfer and backup are
future modules; no inactive controls are displayed.

The app signs in to **real Firebase Authentication** and calls the trusted Node
API with its Firebase ID token. The API checks live `users` / `kiosks` documents,
performs Firestore transactions through Admin SDK, and reads fresh ESP32 status.
It must have both internet and access to the controller's LAN. The tablet sends
the committed power command directly to the controller with its pairing token.
The server independently checks controller results; tablet claims cannot mark
a PC as started. No Firebase emulator endpoints are used or accepted.

**Why a trusted API:** a temporary ID-entry kiosk cannot safely enumerate student
records or be trusted to enforce privileged transitions itself. All direct
Firestore reads/writes are denied, including to mobile administrators. The
server is the only writer and validates roles, inputs and transitions. The rules
are deliberately deny-all; installing permissive rules is not a setup step.
Admin SDK bypasses rules, so protect its IAM identity and host.

**Cost:** this is a standalone service, not a Cloud Functions deployment. It can
run on a secured existing laboratory computer behind HTTPS. Firebase Auth email
and password and Firestore can use applicable Spark quotas; check your project's
usage. Hosting elsewhere may cost money. Moving this API to Cloud Functions
would require Blaze billing. No paid service is silently provisioned.

The API needs an **always-on trusted host**, such as a staff computer; that host
must not be a student-controlled PC that the prototype powers on and off. It
cannot run with Admin credentials inside this tablet app. Off-LAN hosting also
requires a secure private network path to the ESP32 controller; simply deploying
to Cloud Functions does not make the LAN controller reachable. No host or VPN is
provisioned automatically.

## Firebase setup

1. Create a **separate ComLab Firebase project**. Enable Authentication →
   Email/Password and create a Firestore database in production mode, selecting
   an appropriate region. Do not enable anonymous kiosk access.
2. Register Android application `com.comlab.kiosk`. Install Firebase CLI and
   FlutterFire CLI following [official Flutter setup](https://firebase.google.com/docs/flutter/setup).
   In this directory run:
   ```powershell
   firebase login
   dart pub global activate flutterfire_cli
   flutterfire configure --project YOUR_COMLAB_PROJECT_ID --platforms android --android-package-name com.comlab.kiosk
   firebase deploy --only firestore --project YOUR_COMLAB_PROJECT_ID
   ```
   The explicit project argument avoids accidentally deploying to eSURSECO.
3. Copy the real Android `apiKey`, `appId`, `messagingSenderId`, `projectId` from
   generated `lib/firebase_options.dart` into a local, ignored `config/firebase.json`:
   ```json
   {
     "FIREBASE_API_KEY": "YOUR_REAL_ANDROID_API_KEY",
     "FIREBASE_APP_ID": "YOUR_REAL_ANDROID_APP_ID",
     "FIREBASE_MESSAGING_SENDER_ID": "YOUR_REAL_SENDER_ID",
     "FIREBASE_PROJECT_ID": "YOUR_COMLAB_PROJECT_ID"
   }
   ```
   These are public Firebase application identifiers, not privileged secrets.
   Restrict API keys appropriately. The app initializes Firebase explicitly from
   these build values. The generated options file is a configuration reference;
   it is not imported by this source. Without the four values, the APK displays
   **Firebase setup required**, with no demo records.
4. On the **trusted API host only**, set up Application Default Credentials using
   [Firebase Admin setup](https://firebase.google.com/docs/admin/setup). Prefer
   a dedicated attached identity on Google hosting. For a local host, keep the
   downloaded service-account JSON outside this project with restricted OS ACLs.
   Never put it on the tablet, in assets, or in Git. Grant only required Firestore
   and Firebase Authentication server permissions. Do not reuse unrelated
   application credentials.
5. Server environment (PowerShell, substitute your actual values):
   ```powershell
   $env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\secure\comlab-server-identity.json'
   $env:GOOGLE_CLOUD_PROJECT = 'YOUR_COMLAB_PROJECT_ID'
   $env:CONTROLLER_URL = 'http://comlab-controller.local'
   $env:CONTROLLER_TOKEN = 'YOUR_RANDOM_PAIRING_SECRET'
   $env:CONTROLLER_TIMEOUT_MS = '4000'
   $env:PORT = '8080'
   $env:HOST = '127.0.0.1'
   cd server
   npm ci
   npm start
   ```
   The program reads environment variables; it does not auto-load `.env` files.
   Place an HTTPS reverse proxy with a certificate trusted by Android in front of
   loopback port 8080. A trusted local CA is possible only when installed as a
   system CA / managed trust configuration; do not disable certificate checks.
   DNS and firewall configuration must let the tablet reach your HTTPS API.
   Keep port 8080 private. Start the process as a supervised service for real use.

## First administrator and kiosk provisioning

There is no public registration or automatic role promotion.

1. The Firebase project owner creates two distinct Email/Password users in the
   Firebase Console: a named administrator account and a dedicated tablet kiosk
   account, using strong unique passwords. Copy their Authentication UIDs.
2. From `server/` on the trusted host with ADC, explicitly provision each:
   ```powershell
   npm run provision -- admin ADMIN_AUTH_UID
   npm run provision -- kiosk KIOSK_AUTH_UID
   ```
   These commands write roles/approval and audit records, and revoke old refresh
   tokens. Sign in again after provisioning. Privileged credentials stay on the
   provisioning host. For revocation:
   ```powershell
   npm run provision -- revoke AUTH_UID
   ```
3. On first tablet launch, save the HTTPS API URL, controller address, pairing
   secret and timeout, then authenticate the approved kiosk account. The kiosk
   password is not saved by ComLab; Firebase manages refresh credentials. The
   pairing secret and pending IDs use Android secure storage with backup disabled.
4. Use **Administrator** to sign in with the separate administrator account.
   Configure the real students and manually create PC-01 … PC-05, each with its
   actual unique node ID. Initially there are no students or PCs.
5. Leave Admin explicitly. Admin uses a separate Firebase Auth instance, which is
   signed out when leaving and on every app process startup. Student mode uses
   only the approved kiosk account. Settings after initial setup require Admin.

## Build and install

Use Flutter stable supporting Dart 3.11, Java 17, Android SDK / build tools and
accepted SDK licenses. The repository locks compatible resolved packages. The
current Android Gradle Plugin is 8.12.1, Kotlin 2.4.21 and wrapper 8.14; these
meet [share_plus requirements](https://pub.dev/packages/share_plus). Dependencies
also follow the [Kotlin Gradle compatibility matrix](https://kotlinlang.org/docs/gradle-configure-project.html),
including Firebase Auth 25's Kotlin 2.4 metadata requirement. Dependencies
were checked against their official publisher documentation, including
[Firebase Auth](https://pub.dev/packages/firebase_auth),
[secure storage](https://pub.dev/packages/flutter_secure_storage), and
[HTTP](https://pub.dev/packages/http).

```powershell
flutter doctor -v
flutter doctor --android-licenses
flutter pub get
dart format lib test
flutter analyze
flutter test
flutter build apk --debug --dart-define-from-file=config/firebase.json
adb install -r build/app/outputs/flutter-apk/app-debug.apk
```

`flutter build apk --debug` without configuration also builds an installable
setup-only app. It cannot access Firebase until rebuilt with real identifiers.
The default release signing is Flutter's development template: configure a
private signing keystore before distribution. Debug APKs are for lab testing.
The UI adapts to landscape and portrait; no hard orientation lock is applied.

Android targets API 36. `INTERNET` and `ACCESS_NETWORK_STATE` are declared.
[Android 16 LAN protection](https://developer.android.com/privacy-and-security/local-network-permission)
is opt-in; this app does not opt in. Revisit runtime local-network permission
handling before increasing target SDK to a version that mandates it.
Cleartext is denied globally and allowed **only** for `comlab-controller.local`,
also checked in the Dart client. Configure router DNS or ESP32 mDNS for that
name; an arbitrary HTTP IP will be rejected. HTTPS controller URLs work with
trusted certificates. This one-host HTTP exception sends the pairing token in
cleartext: restrict the prototype to an isolated lab LAN and migrate the
controller to HTTPS before wider deployment. Secure storage protects at rest,
not against interception on this prototype HTTP connection.

## Behavior and safety boundaries

* Exact registered IDs identify records; they **do not verify the person**. A
  kiosk may look up one record at a time (rate limited), view its active session,
  report issues or explicitly check out. Guessable IDs remain vulnerable to
  impersonation and limited enumeration. Supervise the kiosk; fingerprints or
  another verified factor are future work. There is no automatic checkout on
  repeated entry.
* `activeStudents/{studentId}` and each PC's `sessionId` are checked/written
  together with the session and command in a server transaction. Deterministic
  operation/session/command IDs and a tap guard prevent duplicate allocation.
  New students use create-only transactions; IDs cannot be changed by editing.
* Assignments require active students, enabled/unrestricted PCs, matching fresh
  node reports (under 15 seconds), and explicitly known ON/OFF power. Unknown
  power, disconnected/stale nodes and PC/student conflicts are rejected.
* Only confirmed OFF creates a `power_on` command. Confirmed ON creates no
  command. Acceptance and startup confirmation have separate UI steps.
* The controller must persistently deduplicate command IDs and reject a pulse
  if power is now ON or UNKNOWN. See [controller contract](docs/CONTROLLER_API.md).
  One automatic transport retry uses the same ID and payload within the initial
  submission. The app never replays a command after restart.
* Pending identifiers are stored before requesting cloud reservation. Startup
  recovery reads and reconciles only. UNKNOWN/accepted/pending delivery holds
  the PC and blocks checkout/reassignment. Rejected/failed results must be
  terminal with no possible delayed pulse. Staff reconciles through attendance.
* A reservation whose cloud result is unknown is never assumed successful. If
  the operation has no committed session, staff can cancel it in Settings;
  the server writes a tombstone checked by reservation transactions, preventing
  a late commit. This does not cancel a committed power command.
* Checkout and reassignment are transactional. Staff reasons are required.
  Reassignment closes the old session and opens a linked new one atomically.
  Checkout does not shut down, restart or pulse the PC. Those capabilities are
  intentionally unavailable without controller/Windows-client support.
* Idle input and unreachable network never release an assignment or imply OFF.
  Assignment, power, network, input, and node connectivity remain separate.
* All mutations require a successful online API / Firestore transaction. No
  offline write queue is used. Admin retains its last loaded snapshot in memory
  after fetch failure and labels it stale/read-only. Data is not persisted in an
  unencrypted roster cache. Polls run every 15 seconds while Admin is visible.
* Student results reset after the configured 10–120 second timeout (default 25).
  Pending identifiers remain private in secure storage for subsequent recovery.
  An administrator-created pending reassignment requires an administrator to
  reconcile it because operation reads are bound to the creating account.
* CSV uses all current history filters and escapes spreadsheet formulas. Export
  opens Android's share/save sheet and needs no broad storage permission.

## Verification and deployment acceptance

See [verification record](docs/VERIFICATION.md) for actual local check results.
`server/test` uses an in-memory transaction adapter **only in unit tests**; it
does not connect to an emulator or replace production Firebase. Tests exercise
the production service's uniqueness, retries, cancellation, checkout and
reassignment logic. Flutter tests cover command retry IDs, no pulse on known ON,
read-only restart recovery, tap guards, and setup/tablet layouts.

Before a supervised pilot, use real provisioned test accounts and verify two
tablets racing for one PC, loss of cloud access before and after commit,
controller restart/deduplication, mapping mismatches, lost acknowledgments,
student/admin sign-out, role revocation, and actual power sensing. No firmware,
Windows monitoring agent, AS608 scanner or Orange Pi is supplied. No hardware
integration or live Firebase end-to-end behavior is claimed as tested.

This prototype lists full administrative collections and filters history on the
trusted server. It is appropriate for a small laboratory, not a large campus.
Add indexed pagination, archival/retention controls and host monitoring before
larger deployments. `firestore.indexes.json` has no composite indexes because
current queries need only default single-field indexes (node mapping). Audit is
append-only through application API; the Firebase owner/IAM administrator can
still alter the database. Review retention/access policy for student PII.

Files: `lib/` app, `server/` trusted service/provisioning/tests,
`firestore.rules` / `firestore.indexes.json`, [schema](docs/SCHEMA.md),
[controller contract](docs/CONTROLLER_API.md).
