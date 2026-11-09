# Local verification record

## GitHub Pages migration - 2026-11-07

The user selected GitHub Pages as the replacement host. The static dashboard
in `web/admin` was built and pushed in commit `e7fcdf7` with an Actions Pages
workflow and an exact-origin browser CORS policy for the existing Render API.
GitHub Actions run `42275106724` successfully built and deployed it to
`https://test052026123-code.github.io/Comlab/`. The site no longer uses the
Sites Worker proxy. Public assets contain no student records or private keys;
approved Firebase admin authentication is still required for lab data.

All 39 server tests and the migrated desktop/mobile browser tests pass.
The initial live API preflight still returned 401 without CORS headers, which
means Render needs to deploy the API commit before real dashboard login works.

## Browser admin dashboard - 2026-11-07

Implemented a separate private Sites dashboard in `sites/comlab-admin`, reusing
the registered ComLab Firebase Web app and existing Render API. No service-account
or controller credentials are included. Firebase password authentication uses
memory-only sessions; the API verifies approved admin roles on every request.
The Worker proxy uses a fixed origin, explicit route/method allowlist, same-origin
write checks, no caching, and manual redirects that are rejected before following.

TypeScript checking and five proxy tests pass. Chrome browser checks with
intercepted synthetic records pass for kiosk-role rejection, dashboard reads,
student creation/editing, fingerprint linking/unlinking, single relay-test
submission after explicit bench confirmation, stale read-only records, sign-out
cleanup, and responsive desktop/mobile layouts. No live student mutation or
physical relay command was sent by these tests. Public Firebase Web configuration
accepted a negative sign-in probe (`INVALID_LOGIN_CREDENTIALS`); the actual Worker
proxy reached Render and returned its expected 401 for an invalid bearer.
Real administrator sign-in and live-record acceptance remain for the user.

Published privately using the Sites skill as version
`appgver_b78b96cfcbf48191b400d979aeb4d21b` from source commit
`f5ee14f9d325600efb074bf20f8f6b130afb0415`. The native deployment returned
`succeeded` and `https://comlab-admin-dashboard.aiken-high-8215.chatgpt.site`.

## Remote relay bench control - 2026-11-07

API commit `5059fcb` is live at the existing Render origin with
`apiVersion: node-bench-2`. All 38 server tests pass; app dialog tests cover
explicit single submission, read-only polling, the same UUID after an uncertain
POST, and safe dismissal. Existing app tests passed except an outdated test
finder, corrected and verified by rerunning all three relay dialog tests.
Flutter analysis and the extended relay timer/policy host tests pass.

The central and NODE-01 were compiled and uploaded with verification. The node
was initially on COM3 and moved to COM4 after reconnecting; central is COM5.
A backend maintenance diagnostic returned `pulse_finished` through the complete
cloud-to-central-to-node-to-cloud path. Node serial status independently showed
its matching command journal finished and GPIO23 LOW. No PC power status or
workstation eligibility was changed. The first diagnostic expired without a
node journal entry, so no pulse was inferred from that timeout.

App build 15 was built as `ComLab-Node-Test-build15.apk`. After the tablet was
reconnected, `adb install -r` succeeded, Android package inspection confirmed
versionCode 15, and the app was launched. Existing app data was retained.

## Connection recovery and error layout - build 9

The user reported an unreachable API message whose inline banner also clipped
the keypad. The local Node API still answered its authentication guard, but
there was no cloudflared process and the old public origin failed the transport
probe. A new temporary tunnel was started to the existing loopback API; normal
certificate validation and the expected unauthenticated ComLab guard passed.
Its actual origin is in ignored `server/.local/trusted-api-url.txt`. This probe
does not prove authenticated Firebase account approval or a real check-in.

Student-screen errors now use a header View error button and a details dialog,
instead of consuming keypad/PC-grid height. Other admin/setup error presentations
remain in their scrollable forms. Closing the details dialog clears the message
without changing screen, reservations or timers.

Because admin login normally calls the saved API, an expired tunnel also blocks
opening Settings. The admin sign-in form now accepts a replacement HTTPS origin.
Validation rejects paths, URL credentials, query/fragment values and kiosk
overrides before sign-in. After Firebase sign-in, the new destination must approve
the administrator via /me and accept /admin/connection-settings audit before local
settings are saved; only then is the app's active URL updated and admin UI entered.
The user must enter their own administrator credentials on the tablet. No password
or Firebase ID token is requested through tools or chat for recovery.

All 24 tests passed serially and analysis found no issues. New tests verify error
messages preserve exact keypad/card bounds at the U24 Pro viewport, details can
be opened/dismissed, unsafe origins and kiosk overrides are rejected, and admin
UI forwards the proposed origin while failed sign-in retains the prior address.
Configured debug build 9 succeeded and was installed over build 8 using ADB.
Package inspection confirmed versionCode 9. On the actual tablet, submitting an
empty student ID generated local validation feedback through View error while
all keypad rows remained fully visible (`server/.local/comlab-error9.png`).
No student lookup or relay request was sent for this UI check.
The admin sign-in form was opened and its proposed API origin replaced with the
verified new tunnel address; the screenshot `comlab-admin-recovery9.png` confirms
the complete value. No email/password was entered and Sign in was not submitted.
The user must authenticate on the tablet to approve and persist the new URL;
until then the saved API address remains the old one. The recovered tunnel is
currently running, and its latest HTTPS/guard probe passed.
Delivery: `build/app/outputs/flutter-apk/ComLab-Recovery-build9.apk`.

## U24 Pro keypad sizing - build 8

The user supplied a physical-tablet screenshot of clipped keypad numbers.
Read-only ADB checks identified the connected U24 Pro: physical 800x1280,
landscape 1280x800, density 240 dpi (1.5 device pixel ratio), font scale 1.0,
and Android system bars reducing application height. Build 7's prior logical
800x600 tests did not represent that viewport; its flex keypad could shrink
below the text height.

Short entry panels now use a compact heading and labeled field, reduced spacing,
and four complete keypad rows. Header/footer spacing is reduced on short screens.
The regular reference layout remains for taller viewports. Letter-keyboard entry
has a horizontal input/action layout when the available height is very short.
No global Android density, font settings, Firebase credentials, or relay behavior
were changed.

All 21 tests passed serially and analysis found no issues. The new regression
uses the physical 1280x800 size, DPR 1.5, and system padding (36 top / 72 bottom
physical pixels). It checks every numeric key and Clear: visible, at least
40 logical pixels high, with its text fully inside its button. It also exercises
numeric input, the letter keyboard with an inset, and return to numeric mode
without losing an alphanumeric ID.
Configured debug build 8 succeeded. ADB installed it over build 7 on the connected
tablet and package inspection confirmed versionCode 8. The actual tablet capture
`server/.local/comlab-keypad-build8.png` shows all four complete keypad rows plus
Continue and Check Out. A physical-coordinate tap on 1 entered `1`, verified in
`comlab-keypad-input8.png`; Clear was then tapped to leave the field empty.
No Continue action, student lookup, reservation or relay command was performed.
Delivery: `build/app/outputs/flutter-apk/ComLab-Keypad-build8.apk`.

## Fixed tablet layouts - build 7

The user clarified that the reference requires a fixed screen, while build 6
used scrolling containers. WelcomeScreen now uses bounded rows/columns with
flexible artwork and keypad rows. PC selection uses a bounded card grid and a
fixed confirmation bar; student cards size their artwork to the remaining height.
Tablet landscape uses two check-in columns starting at 700 logical pixels.
Portrait uses a compact introduction and bounded entry panel. Header/footer
spacing was reduced to retain usable touch targets on shorter tablets.

Numeric ID entry suppresses the system keyboard, avoiding an unintended resize.
The optional letters/symbols keyboard switches to a compact input panel with
Continue still visible. Pending-operation recovery remains available and uses
the existing read-only reconciliation path. No reservation/controller protocol
or real laboratory records were changed.

All 20 tests passed with `flutter test --no-pub --concurrency=1`; analysis found
no issues. The new layout test checks 800x600, 1024x600, 1024x640, 1280x800 and
800x1280: no vertical page Scrollable, visible/hit-testable Continue, Check Out,
all five PC IDs and PC confirmation, and numeric keys at least 40 logical pixels
high. Another test checks letter entry with a 300-pixel keyboard inset and
preservation of an alphanumeric ID when returning to the numeric keypad.
The parallel test attempt exhausted this Windows computer's memory; the idle
ComLab Gradle daemon was stopped and the successful suite ran serially.

Ignored review images under `server/.local/` include 1024x600 layouts. These use
test fixtures; production counts still come from backend records. Physical
tablet verification remains pending.
Configured debug APK build 7 succeeded; `aapt` confirms package
`com.comlab.kiosk`, versionCode `7`. Deliverable:
`build/app/outputs/flutter-apk/ComLab-Fixed-layout-build7.apk`.

## Student interface redesign - build 6

The welcome screen was redesigned from the user's supplied image, including
the light header, warm background, teal controls, lab illustration, numeric
keypad and three-step footer. The ID field still accepts letters. Check Out
uses the existing ID lookup and active-session flow. Availability is read from
backend workstation snapshots; unknown counts show a dash and the header says
status not checked. No sample records or connection claims were added to runtime.

PC selection now displays responsive workstation cards with illustrations,
IDs, availability, known power, selection state and a confirmation summary.
Only eligible PCs with a fresh cloud snapshot can be selected and confirmed.
Existing server reservation and controller behavior is unchanged.

All 18 Flutter tests passed; `flutter analyze --no-pub` reported no issues.
New coverage checks numeric insertion/replacement/backspace/clear, session-lookup
mode, occupied-card rejection, stale-selection rejection, and portrait/landscape
rendering at 800x1280 and 1280x800. Review PNGs are in ignored `server/.local/`.
Those preview images use test fixtures, not live laboratory records.
Configured debug APK build 6 succeeded; `aapt` confirms `com.comlab.kiosk`,
versionCode `6`. Deliverable: `build/app/outputs/flutter-apk/ComLab-Redesign-build6.apk`.
The current `ComLab-Firebase.apk` copy is also updated. Physical tablet validation
of the redesign remains pending.


## Add Student dialog lifecycle - build 5

The user clarified that the red screen occurred while adding a student.
Regression tests of the original Add Student implementation reproduced disposed
TextEditingController errors followed by the exact `_dependents.isEmpty`
assertion seen on the tablet. The caller disposed controllers immediately when
the dialog result completed, before the closing route animation removed its fields.

StudentEditorDialog now owns its controllers in State and disposes them when
the dialog widget is removed. Save and Cancel release keyboard focus. The caller
checks mounted state before saving. Both creation and editing use this dialog;
server payloads, identifier normalization and duplicate-ID protection are unchanged.

All 15 Flutter tests passed and analysis reported no issues. Regression coverage
includes focused-field Save and Cancel, closing animation, expected creation
payload, refreshed student list and no write on cancellation. These checks use
an injected repository; no real student records were created during testing.
Configured debug build 5 succeeded. `aapt` confirms package `com.comlab.kiosk`,
versionCode `5`. Delivery: `build/app/outputs/flutter-apk/ComLab-Firebase-build5.apk`.
The tablet still needs verification of this update.

## Sign-in lifecycle update - build 4

The tablet displayed Flutter's `_dependents.isEmpty` assertion. A new widget
test reproduced a related application lifecycle bug: when navigation happens
while login is awaiting, the handler used its disposed password controller.
The test does not establish that this was the tablet's first exception; the
tablet stack trace was unavailable. Both sign-in handlers now capture input,
release keyboard focus, and clear the password before awaiting authentication.
The kiosk handler also checks mounted state before subsequent navigation.

All 13 Flutter tests passed, including sign-in failure, retry and asynchronous
navigation; analysis reported no issues. Configured debug build 4 succeeded.
The distinct deliverable is `build/app/outputs/flutter-apk/ComLab-Firebase-build4.apk`;
`ComLab-Firebase.apk` is updated as well. Tablet verification is still needed.

## Redirect diagnostic update - build 3

The tablet reported HTTP 302 during sign-in, while desktop probes of the current
HTTPS tunnel returned the expected 401 without a Location header. Root cause is
still unconfirmed. The app now reports the request origin and redirect origin,
excluding URL credentials, paths and query tokens. Redirects remain disabled;
certificate validation remains enabled. No authentication token is forwarded to
the redirect destination.

All 12 Flutter tests passed, including redirect rejection and diagnostic secret
redaction; `flutter analyze` reported no issues. The configured debug APK build
3 succeeded and is delivered as `build/app/outputs/flutter-apk/ComLab-Firebase.apk`.
Install over the existing app and retry kiosk sign-in to collect the diagnostic.

## Configured Android update — build 2

After the user provisioned the ComLab Firebase project and reported the old APK's
setup-required screen, the actual `com.comlab.kiosk` Android app was registered
in `comlab-2ed9d`. Its genuine Android configuration was retrieved through the
Firebase Management SDK and saved to ignored `config/firebase.json`.
No web app ID, invented Firebase values, or server private key was used.

`flutter build apk --debug --no-pub --build-number=2 --dart-define-from-file=config/firebase.json`
passed. Deliverable: `build/app/outputs/flutter-apk/ComLab-Firebase.apk`
(156,543,518 bytes). The default `app-debug.apk` is also now the configured build.
`aapt` confirms package `com.comlab.kiosk`, version `1.0.0`, code `2`, minimum API
24, target API 36. The packaged Flutter kernel contains the correct project and
actual Android app ID. No server credential files or server node_modules were
present in APK entries. Application source was unchanged for this configuration
update. No Android device was connected through the SDK's ADB, so on-tablet
installation and Firebase sign-in still need verification.

SHA-256: `CE23802CD811DA21A3B0BA202FFF9E692B13114CBA645D9A8DD9D3CCB4BAB9C9`.

The remaining sections describe the original setup-only build and original
verification environment; their original artifact hash is historical.

Environment: Windows, Flutter 3.41.4 / Dart 3.11.1, Java 17.0.19, Node 24.15.0,
Android SDK at `C:\Android`. No Firebase project configuration, approved test
accounts, physical Android tablet or ESP32 firmware was supplied.

## Source checks

* `dart format lib test`: formatted source and tests.
* `flutter analyze --no-pub`: **no issues found** on the final source.
* `flutter test --no-pub`: all **11** tests passed, including the administrator
  isolation regression check.
* `npm test` in `server/`: all **13** service/domain tests passed.
* `node --check src/index.js` and `node --check scripts/provision.js`: passed.

Server tests cover concurrent allocation of one PC, multiple-PC attempts by one
student, operation idempotency after a controller outage, pending-command checkout
blocking, idempotent checkout, no command for a confirmed-ON PC, ineligible node
states, atomic reassignment, cancellation tombstones, role approval, unique node
mapping, and safe CSV output. Flutter tests exercise the actual state/controller
implementations with injected test adapters, including exact retry payload reuse,
no command replay on recovery, tap suppression, failure retention and both tablet
orientations. This is not a real Firestore contention or hardware test.

## Android build

The first build was stopped because the Flutter template's 8 GiB Gradle heap
exhausted this computer's roughly 4 GiB RAM. Project settings now cap Gradle at
1.5 GiB with two workers and use the Kotlin compiler in-process.

The next build exposed Firebase Auth 25.0.0's Kotlin 2.4 metadata incompatibility
with the template's Kotlin 2.2.20. The project now uses Kotlin 2.4.21 and migrated
the app to `compilerOptions.jvmTarget` (Java 17) as required by that compiler.
AGP 8.12.1 / Gradle 8.14 follow the official compatibility matrix linked in README.
**Final build passed:** `flutter build apk --debug --no-pub` produced
`build/app/outputs/flutter-apk/app-debug.apk` (156,542,182 bytes). This universal
debug APK includes the Android ABIs selected by Flutter. No Firebase identifiers
were supplied, so this artifact opens the honest setup-required state. Rebuild
with your real `config/firebase.json` to activate Firebase authentication.

`aapt dump badging` confirms label **ComLab**, package **com.comlab.kiosk**,
version **1.0.0 (1)**, minimum SDK **24** and target SDK **36**. The packaged
Flutter kernel was generated after the final application source changes.
SHA-256: `BBD2A9477EB461EB4CEC509488A2A6FB38B04B67623B1767CE72B72402C2BE71`.

`flutter doctor` also reports some Android SDK licenses unaccepted. The build
passed for this project's installed components despite that doctor warning;
no license agreement was accepted automatically. No physical tablet was
connected, so installation and on-device behavior have not been verified.

## Dependency audit

`npm audit --omit=dev` reports **6 moderate** transitive advisories involving
glob/minimatch through rimraf and the Firebase Admin SDK's Google libraries.
Firebase Admin was updated to 14.5.0 and `npm audit fix` was attempted; these
advisories remain in its current dependency graph. No high/critical findings were
reported. Broad forced overrides across major library versions were not applied.
Review upstream patches and repeat the audit before production deployment. The
application does not accept user-supplied glob patterns or expose filesystem
traversal APIs, but this is not a claim that transitive findings are harmless.

## Not verified against live services

Firebase rules deployment/real-project transactions, auth provisioning and
revocation, HTTPS deployment, tablet secure-storage behavior, local DNS,
controller authentication/persistent deduplication, relay wiring, real power
feedback and startup behavior all require the configured environment/hardware.
No end-to-end Firebase or ESP32 integration success is claimed.

Use the pilot acceptance checklist in README before putting actual students on
the system. Student ID entry remains a temporary record lookup, not identity
verification.
# Cloud migration local verification

Node relay bench update: the user confirmed GPIO23 through a resistor and
2N2222A to relay IN1, with a 5V coil module. Added serial ARM/TEST/OFF/STATUS/HELP;
boot is OFF/disarmed, TEST requests one approximately 300ms pulse, cooldown is
three seconds, and arming expires after 60 seconds. A separate timer task owns
HIGH transitions and releases the output while the network loop is blocked.
No cloud relay command path or fabricated PC power feedback was added.

The actual RelayBench.h passed Windows host C++ tests with simulated GPIO,
serial and ESP timers: boot/arming, pulse duration without loop polling,
cooldown, OFF/cancel, expiry, timer failures, CRLF and oversized input. This is
software validation, not a physical timing/contact test. The complete node
compiled with one job for ESP32 DOIT DevKit V1, core 3.3.7 / ArduinoJson 7:
963,594 bytes flash (73%), 49,724 bytes globals (15%). Node binary identity and
pairing preflight are provided by Upload-Node.ps1/check-node-binary.js.

The user identified COM3 as the PC-01 node. The initial upload was blocked by
port access; after the user closed its serial application, esptool identified
the known node MAC `b0:cb:d8:e9:91:8c`, wrote and hash-verified the firmware, and
reset the node. A bounded read-only serial STATUS check returned
`GPIO23: LOW (off); test: disarmed. PC power: unknown.` and repeated controller
heartbeat acknowledgements. The serial port was then closed. No ARM or TEST
command was sent by the agent; relay clicks, physical timing and contact
continuity remain for the user to verify with the relay disconnected from the PC.

Workstation-dialog fix: a focused create/save regression test reproduced both
`TextEditingController was used after being disposed` and `_dependents.isEmpty`
on the original form. `WorkstationEditorDialog` now owns its controllers, clears
focus before closing, and disposes controllers with its route state. The admin
caller checks `mounted` after awaiting the dialog. All 33 Flutter tests passed,
including focused workstation create, cancel, edit and API-failure paths;
analyzer found no issues. A read-only live check found PC-01 was not yet saved;
no workstation or student data was written during testing.
APK build 13 compiled successfully and was installed over the existing app on
tablet `0123456789ABCDEF` with `adb install -r`, then launched. Android reports
versionCode 13 / versionName 1.0.0. No account password was entered during this
delivery, so the physical workstation-create flow still requires the approved
administrator to sign in and retry; the regression paths above were tested
using an in-memory repository.

Windows low-memory recovery: the observed machine had approximately 500 MB free
physical RAM and 797 MB free virtual memory when diagnosing repeated cc1plus
allocation failures. Added `Build-Firmware.ps1` with `--jobs 1`, plus a prebuilt
`Upload-Controller.ps1` path that skips compilation. Both target path checks
passed. Prebuilt validation confirmed the node-receiver banners, current local
Wi-Fi/cloud settings, all five peer keys, and required bootloader/partition
binaries without printing secrets. No recovery upload was performed because
the controller's current COM port had not been identified. The single-job
helper was checked without launching another compiler under memory pressure.

Node discovery update:

- Added `firmware/comlab_node/comlab_node.ino` and the matching controller UDP
  receiver. Both use separate per-node HMAC keys, signed acknowledgements,
  identity/sequence/time checks and real heartbeat freshness. No GPIO is read
  or driven; power/reachability/input stay unknown.
- Node compiled for DOIT ESP32 DEVKIT V1 / ESP32 core 3.3.7 / ArduinoJson 7.4.3:
  956,934 bytes flash (73%), 49,644 bytes globals.
- Updated controller compiled: 1,166,401 bytes flash (88%), 51,492 bytes globals.
- 29 server tests passed, including discovery-only nodes remaining ineligible
  and failing reservation while power is unknown.
- Local configuration checks verified matching protocol headers, all five
  per-node pairings, PC-01 configuration, exclusion of the Render device key
  from node configuration, and the example UDP envelope fitting 1024 bytes.
- The user reported authenticated Render acknowledgements from the earlier
  controller connection-test firmware. This updated controller/node pair has
  not been flashed or physically tested by the agent. No claim of on-device
  HMAC interoperability, real node reception, sensing, or relay control is made.
- See `firmware/NODES_SETUP.md` for exact upload order and limitations. The
  tablet APK is unchanged by this firmware update.

Render timeout update: live HTTPS process health returned 200 in approximately
0.7 seconds during diagnosis, while user endpoints correctly required Firebase
credentials. A refresh from the signed-in tablet then successfully reached the
Firebase-backed workstation endpoint and reported the controller offline. That
verifies the current approved kiosk/Firestore read path; it does not verify key
rotation or ESP32 connectivity. The original timeout's exact cause was not
captured in Render logs; Free service startup/redeployment is a possible cause.

Cloud HTTP deadline is now 90 seconds instead of 20. Student lookup/read timeouts
offer retry instructions, while write timeouts retain uncertainty/reconciliation.
No request is automatically resent. All 29 Flutter tests passed, including a
simulated 60-second read, lookup timeout, and no duplicate reservation after a
timeout; analyzer found no issues.
APK build 12 compiled, installed over the existing tablet app using `adb install
-r`, and launched successfully. Android reports versionCode 12. No account
password, Firestore mutation, or hardware command was supplied during diagnosis.

Fixed-origin update: the app uses `https://comlab-api.onrender.com` through an
immutable source constant. Legacy saved tunnel origins are ignored; sign-in and
settings have no API address input. All 26 Flutter tests passed, including fresh
installation/legacy-setting migration, sign-in failure/retry and redirect
credential protection. Analyzer found no issues. APK delivery status is below.

Build 11 (`ComLab-Cloud-build11.apk`) compiled successfully and was installed
over the existing app on connected tablet `0123456789ABCDEF` using `adb install
-r`. Android reports versionCode 11 / versionName 1.0.0. The app was launched;
no administrator/kiosk password was entered during delivery. Installation
retains application data; the old saved API origin is ignored by this build.

- Server: 28 tests passed, including cloud auth, atomic queue creation, sequence
  replay, stale telemetry, command expiry and no redelivery after controller reboot.
- Flutter: 26 tests passed; analyzer found no issues. Cloud commands retain their
  IDs and never fall back to a direct LAN submission on failure.
- Bounded cloud-mode startup check passed using real protected server credentials:
  public process health and separate user/device authentication guards. This
  check performed no Firestore writes or hardware commands.
- Connection-test firmware compiled for ESP32-WROOM DOIT DevKit V1 with Arduino
  ESP32 3.3.7 / ArduinoJson 7.4.3: 1,117,693 bytes flash, 48,420 bytes globals.
- Deployed `https://comlab-api.onrender.com`: normal HTTPS trust passed;
  `/healthz` returned 200, `/health` and `/controller/status` returned 401 without
  Firebase credentials, and `/v1/controller/sync` returned 401 without device
  credentials. These checks did not authenticate to Firebase or send hardware work.
- The protected device credential was accepted by Render: an authenticated,
  deliberately invalid sync body reached schema validation (400), without
  Firestore writes or command delivery. This does not verify Firebase credentials.
- Not verified: approved-user/Firebase access through Render, uploaded cloud
  firmware, physical PC node telemetry, relay execution.
- Cloud-compatible debug APK build 10 was built successfully. It has not been
  installed on the tablet during this migration; settings are not changed.

## AS608 update — 2026-11-07

Local checks for fingerprint check-in: `npm test` passed all 33 server tests;
`flutter test --no-pub --concurrency=1` passed all 35 app tests; Flutter analysis
reported no issues. Tests cover request ownership/expiry/cancellation, late UI
responses, unique student/slot links, inactive/unlinked students, pending-work
guards, and tablet layouts without a student ID input.

Configured debug APK `ComLab-Fingerprint-build14.apk` (versionCode 14) built
successfully and is ready for installation with the matching API/controller.

Arduino ESP32 core 3.3.7 and Adafruit Fingerprint Sensor Library 2.1.4 compiled
the updated central controller (1,174,692 bytes flash, 52,192 bytes global RAM)
and supervised enrollment sketch (284,096 bytes flash, 22,228 bytes global RAM).
The controller binary checker confirmed the AS608 reader, node receiver and
current local configuration without printing credentials. No firmware upload,
Render deployment, live Firestore mutation, or tablet installation was performed
for this update. The user reported the standalone sensor test working; full
scan-to-cloud-to-tablet validation remains a rollout acceptance step.

See [enrollment and storage](../firmware/FINGERPRINT_SETUP.md).
