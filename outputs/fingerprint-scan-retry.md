# Fingerprint scan retry fix ? build 25

The operator reports alternating not-recognized, scan-expired and connection-timeout messages while testing Mark Brian. Live controller logs recorded a completed no_match followed by authenticated HTTPS acknowledgements. A no_match result originates from the sensor search, before Firebase student-link lookup; network retry changes do not fix an unrecognized template.

App changes: fingerprint GET polls have a 10-second transport deadline instead of the generic 90-second deadline. Transport failures and HTTP 408/429/5xx are explicitly retryable. Check-in polling retains the original scan UUID on those failures, creates no second scan and sends no cancellation. Authentication, authorization and other permanent failures still stop the scan. A 70-second local timer bounds recovery after the initial request is acknowledged; the server scan lifetime remains unchanged. Genuine no_match/unlinked/expired/error results remain terminal. No automatic re-enrollment or student-link changes were performed.

Validation: 69 Flutter tests pass, including transient-failure recovery into the original matched request, bounded offline polling, permanent authorization failure, HTTP retry classification and the shorter fingerprint GET timeout. Debug APK build 25 built and signing certificate verified against the current debug key. Artifact: build/app/outputs/flutter-apk/ComLab-Scan-Retry-build25.apk.

Deployment: installed with adb install -r and verified versionCode 25. App data preserved.

Live network diagnosis: the tablet was connected to Emuhmama2001 with no validated internet; its gateway returned Destination Net Unreachable and DNS failed for both API and Firebase Auth. Host API health returned HTTP 200. Switched the tablet to its saved PLDTHOMEFIBReV4Y7 network. Android then reported validated internet, Firebase host resolved/replied, and administrator sign-in succeeded.

Mark Brian Quimpan STU-20269694 has fingerprint slot 3. First re-enrollment attempt returned mismatch; a later attempt expired while waiting for the second scan. A further attempt advanced to second scan; the operator subsequently reported successful enrollment and returned to welcome. A check-in verification still expired without a match. Thus check-in success is not confirmed. Operator then requested both ESP32 boards use hotspot Redmi. That migration is tracked separately. Do not bypass fingerprint identity verification or fabricate a matched result.
