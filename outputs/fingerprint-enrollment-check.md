# Fingerprint enrollment check — 2026-11-11

Live tablet inspection: ComLab build 18, selected student bryan.

- Initial result: finger already stored on the sensor but not linked to a student.
- Started one fresh enrollment through the tablet's existing authenticated dialog.
- Controller serial COM10 reported the second-finger prompt and `Enrollment completed: enrolled.`
- Tablet confirmed `Enrolled in slot 1 and linked to bryan.`
- Controller continued authenticated cloud sync acknowledgments, with zero observed workstation nodes.
- Tablet log also repeatedly reported `station refresh failed: Scanner unavailable. Keep the tablet and ESP32 on the same Wi-Fi.` Its cause remains unverified; enrollment succeeded despite that separate warning.
- All six existing server fingerprint tests passed, including enrollment, duplicate/mismatch handling, ownership, expiry, cancellation, and slot links.

The currently accessible source folder is D:\ComLab. Its ignored Android config still targets comlab-2ed9d, unlike the earlier updated E:\ComLab configuration. The deployed backend's Firebase project and the installed APK's project were not verified by this check.

No templates were deleted, no existing fingerprint links were manually reassigned, and no relay commands were sent.
