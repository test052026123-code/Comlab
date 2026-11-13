# Fingerprint check-in fix ? controller scan-10

The operator confirmed keeping the finger on the sensor while the kiosk waited. The old check-in firmware required observing NOFINGER after cloud request delivery; a finger placed while the tablet was waiting for delivery could therefore block capture until the request expired.

Installed comlab-cloud-scan-10 on controller COM10. Check-in now starts a fresh sensor getImage after request assignment, including when the finger is already resting on the sensor. It still requires a real sensor match against a stored template; existing Firebase slot/student lookup and scan authorization are unchanged. Enrollment still observes NOFINGER between its two conversions and rejects mismatches/duplicates.

Moved blocking authenticated HTTPS transport into a single FreeRTOS worker. One-slot job/reply queues transfer ownership of one exchange; scanner state, node telemetry, command IDs and JSON protocol state remain on the main loop. HTTPS hostname/CA verification, unchanged sequence retry payloads and original command expiry remain enforced. Backoff is bounded at 10 seconds, with faster retry for active scanner work. FINGERSTATUS reports reader state and measured polling gap.

Validation: actual capture engine host tests pass for a held finger on request delivery, delayed finger placement, no match, expiry, required enrollment lift, successful two-image enrollment, mismatches and duplicates. Existing relay, power executor and controller bridge suites also pass. Firmware compiled (1189212 bytes, 90% app space); binary configuration/identity preflight passed; app-only upload at 0x10000 had its flash hash verified. Other flash partitions and node firmware were not changed during this fix. Redmi Wi-Fi settings retained.

Live: scanner ready; NODE-01 connected/executor ready; authenticated cloud sync acknowledged. Measured polling gap was 26?65 ms during initial observation. Operator initiated a check-in scan; controller logged Scan completed: matched, then recovered an intermittent HTTPS -1 transport failure without changing request identity. Operator confirmed Mark Brian?s name appeared in the kiosk. This verifies fingerprint identity check-in, not PC power feedback or physical remote startup.

The installed controller now has matching source and a reproducible normal build in this folder. The prior enroll-9 Redmi image and full flash backup remain ignored local recovery artifacts; do not publish credential-bearing binaries.
