# Failed-start session inspection — 2026-11-11

The authenticated admin view still showed Mark Brian Quimpan, STU-20269694,
assigned to PC-01 in session 2e5016c6-7b1c-4d26-a8d3-d1f1343a5335,
started at 12:53 PHT. PC-01 details confirmed the matching assigned student.

Staff close was attempted with reason 'Closed after failed PC startup at user
request'. The live API refused with 'Assignment integrity error. Contact
administrator.' The session was not confirmed closed. The workstation link
remains, while the student-side marker is missing or mismatched.

The user was asked to restore activeStudents/STU-20269694 with the matching
sessionId only if that document is absent, then Staff close can remove linked
assignments through the deployed API. Existing conflicting links must not be
overwritten.

After the user confirmed the restored field value, Staff close succeeded.
The refreshed administrator view reported 'No active sessions.' The earlier
integrity error cleared. The session was ended through the live API, preserving
attendance history and clearing the matching assignment links atomically.
This does not clear the node's independent unknown-delivery journal or confirm
that the PC wiring/power-on problem has been repaired.

Separately, local server source now permits administrator closure when only the
student marker is missing and the PC still belongs to this session. This is
audited as repairedMissingStudentAssignment. Kiosk closures remain strict;
unknown power commands and other assignment IDs still block closure. All 50
API tests pass. This source change is prepared in the API patch and zip but is
not deployed and did not change the live session.
