# Backend error check — 2026-11-11

The supplied log contains 28 authentication/middleware 401 responses; 23 missing
operation 404 responses; three session-close 409 responses; one session-close
400; one session-close 404; one relay-test start 409; and one relay-test read 404.
It contains no 500 or 503 response and does not identify an IAM permission failure.
The authentication entries omit the failed request path and exact reason, so
they do not establish whether a token was absent, expired, revoked, or invalid.

The missing operation requests followed manual session deletion. App recovery
now stops its timer on 404, clears stale displayed session data, retains the
saved ID, and directs the user to reporting or staff repair. It does not erase
the pending operation or repeatedly poll the missing document.

Admin report validation now accepts both legacy 20-character Firestore issue
IDs and UUID report IDs. This is required by the new report-and-close flow.

Validation: all 48 API tests and all 54 Flutter tests passed; focused analysis
reported no issues. Build 21 was built, signed, and installed as an in-place
update over build 20, preserving data. The API changes are not deployed.

At inspection, the tablet reported that the scanned fingerprint had no student
link. The user identified it as Bryan's newly enrolled finger. Administrator
inspection confirmed Bryan's existing slot is 1 and zero sessions are active.
His unchanged student record was saved through the authenticated app, which
re-establishes the existing slot lookup if missing. No sensor template was
deleted or overwritten. A fresh check-in reached the controller with healthy
cloud acknowledgments, but expired without a scanner result. A successful
physical fingerprint retest remains unverified.

Deployment artifacts: outputs/report-and-close-api.patch and
outputs/ComLab-API-report-update.zip. The server credential pasted into chat was
not copied into either artifact or the app.
