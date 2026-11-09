# AS608 fingerprint check-in

The student welcome screen uses **Scan fingerprint**, with no student ID field
or keypad. Student IDs remain in administrator record management and attendance.
This change requires the updated API, app and central controller firmware together.
Source changes alone do not update Render or an installed tablet application.

## Storage

Fingerprint templates stay in the AS608's onboard nonvolatile database. The app
and API do not upload fingerprint images or templates to Firebase. Firestore
stores student profiles, a unique controller/slot-to-student mapping, short-lived
scan requests, attendance, and workstation records. Firebase Authentication
continues to authenticate administrators and the approved tablet kiosk.

Treat the sensor and its slot assignments as an identity database. Replacing or
erasing the sensor requires re-enrollment and checking every student mapping.
Changing a student's slot in the app does not enroll, move or erase a template.

## Wiring and libraries

On the central ESP32-WROOM DevKit V1, sensor TX connects to GPIO16/RX2, sensor RX
to GPIO17/TX2, and GND to GND. Use the verified power specification for your exact
AS608 module. UART is 57600 baud; USB Serial Monitor is 115200 baud.
Install **Adafruit Fingerprint Sensor Library** (locally verified with 2.1.4).
The cloud sketch also requires the existing ArduinoJson and ESP32 libraries.

## Enroll and link a student

1. Connect the central controller over USB. Open
   `as608_enroll/as608_enroll.ino` and upload to the central board.
   This temporarily replaces cloud sync and node reception.
2. Open Serial Monitor at **115200 baud**, select **Newline**, and send
   `ENROLL 1` for an empty slot within the reported sensor capacity.
   Follow the prompts to scan the same finger twice, removing it between scans.
   Wait for `ENROLLED slot 1`. Occupied slots are not overwritten.
3. In the updated tablet app, sign in as an administrator, create/edit the real
   student, enter **Fingerprint slot: 1**, and save. One slot can link to only
   one student. Leave the slot blank to unlink a student without erasing the
   sensor template. Use another empty slot for the next student.
4. Upload the updated `comlab_cloud/comlab_cloud.ino` back to the central board.
   Keep its existing ignored secrets headers. Templates remain in the AS608.
5. In student mode, tap **Scan fingerprint**, lift the finger, then place it on
   the scanner. A matching linked fingerprint loads the student's confirmation
   or existing session. PC selection still requires known power and fresh nodes.

Enrollment is currently a supervised USB procedure, not a remote app command.
No delete-all or automatic overwrite command is provided.

## Cloud flow

The approved tablet posts a random request UUID to `/fingerprint/requests` and
polls only that request. One pending request owns the central scanner at a time.
The request expires after 60 seconds. Controller sync responses deliver the
request; authenticated subsequent syncs return a matched slot, no-match or error.
The server resolves the slot to the student. No-match, unlinked, expired,
canceled and inactive-student outcomes cannot identify a new check-in student.
An inactive student with an existing session can still retrieve it for checkout.

Matched proofs belong to the requesting account, expire after 120 seconds and
are required for kiosk reservations, checkout and issue reports. Student ID
lookup remains administrator-only. Cancel/navigation clears local scan state;
late responses do not reopen a student's screen. Controller retries preserve
the original cloud payload and fingerprint result until acknowledged.

Normal cloud sync runs about every five seconds, so scans can take several
seconds to reach the app. During network errors the request can expire. Physical
scan-to-tablet behavior must be checked after deploying and uploading all three
components. Power control remains disabled in the discovery controller.

Firestore paths added: `fingerprintMappings/{controllerId}-{slot}`,
`fingerprintRequests/{requestUuid}`, `fingerprintScanners/{controllerId}`;
student records add nullable `fingerprintSlot`. Direct Firestore client access
remains denied. Scan records are retained until staff configures retention;
`expiresAt` is an application expiry check, not automatic document deletion.
