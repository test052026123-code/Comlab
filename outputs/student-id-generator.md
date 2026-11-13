# Student ID generation — 2026-11-11

Build 24 adds Generate to the Unique student ID field when creating a student.
The format is STU- plus the current year and four decimal digits, for example
STU-20262123. Generation starts at a random suffix and skips IDs already loaded
in the administrator student list, including the current field value. It never
overwrites an existing student; the API's existing atomic create/duplicate-ID
check still applies if another administrator creates the same ID concurrently.

The ID can still be typed manually. Editing an existing student keeps the ID
locked and does not expose Generate. Clicking Generate only fills the form;
the student is created only when Save is submitted.

All 58 Flutter tests passed and focused analysis reported no issues. Tests
cover a nearly exhausted ID space, expected format, keyboard focus retention,
exhaustion without overwriting the existing field, and immutable edit IDs.
Build 24 was signed and installed as a normal update. A pre-update unsaved
registration draft was retained privately in server/.local/student-form-draft.json.

Artifact: build/app/outputs/flutter-apk/ComLab-Generate-ID-build24.apk.

Live tablet verification completed after authenticated administrator sign-in.
Generate filled the field with an ID matching STU- plus eight digits, including
the current year, while the keyboard remained open. Save and Cancel remained
visible in the header. The prior draft contained only whitespace in the ID and
no other entered values. The form was left open with the generated ID, unsaved;
no new student record was created during this check. The password supplied for
sign-in was not saved in the project.
