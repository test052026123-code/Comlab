# Firestore schema and authorization

Remote relay diagnostics use `relayBenchTests/{commandUuid}` with target IDs,
service/controller ownership, pending/result state, issue/expiry times, and
`relayBenchControllers/{controllerId}` with the current command pointer. These
are separate from production power commands and sessions. Only administrator
API accounts can create/read diagnostics; authenticated controllers can report
their node's result. No direct client Firestore writes are allowed.

Fingerprint check-in adds `fingerprintMappings/{controllerId}-{slot}` with a
unique `studentId`, `fingerprintScanners/{controllerId}` with the current
request UUID, and `fingerprintRequests/{uuid}` with controller/account ownership,
state and `expiresAt`. Completed matches include the slot and linked student ID.
Student records add nullable `fingerprintSlot`. Templates/images remain in the
AS608; no template or image upload is implemented. Expiry is checked by the API;
automatic Firestore TTL cleanup is not configured. See
[AS608 setup](../firmware/FINGERPRINT_SETUP.md).

Cloud-mode additions: `controllerSnapshots/{controllerId}` stores authenticated
telemetry, last sequence/digest and cached sync reply;
`controllerBoots/{controllerId}-{bootUuid}` prevents retired boot replay;
`controllerQueue/{controllerId}/commands/{commandUuid}` stores durable delivery,
expiry and state alongside atomic session creation. Cloud commands add
`delivery`, `controllerId`, `deliveryBootId`, `deliveredAt` when applicable.
Do not delete boot/command records casually: they participate in duplicate safety.
Cloud node monitoring uses authenticated samples cached in Firestore and their
original timestamps, with a 15-second freshness limit. See
[cloud protocol](CLOUD_CONTROLLER_API.md) and [Render setup](../server/RENDER_SETUP.md).

Use a dedicated project. All collections are private to the trusted API. Direct
Firestore SDK operations are denied by `firestore.rules`, including for clients
with arbitrary Firebase accounts or fabricated admin custom claims. API roles
come from live server-managed documents; no client endpoint sets roles/approval.

| Path | Fields / invariant |
|---|---|
| `users/{authUid}` | `role: admin/kiosk/revoked`, `enabled`, `updatedAt`. Provisioning CLI only. |
| `kiosks/{authUid}` | `approved`, `updatedAt`. Kiosk needs both this approval and enabled kiosk role. |
| `students/{normalizedId}` | `name`, `section`, `active`, `updatedAt`. Unique uppercase ID is the document key. Create checks nonexistence; editing cannot change ID. |
| `workstations/{PC-01…PC-05}` | `nodeId`, `enabled`, `maintenance`, `notes`, `assignment`, `sessionId`, `updatedAt`. No duplicate node mappings. Mapping cannot change while assigned. |
| `activeStudents/{studentId}` | `sessionId`. Deterministic uniqueness lock, created/deleted in session transaction. |
| `nodeMappings/{nodeId}` | `workstationId`. Deterministic mapping lock preventing concurrent creation of two PCs for one node. |
| `sessions/{operationUuid}` | `id`, `studentId`, `name`, `section` (attendance snapshots), `workstationId`, `status: active/closed`, `timeIn`, `timeOut`, `createdBy`, `commandId`. On closure: `closedBy`, `closeReason`. Reassignment adds `replaces` / `replacedBy`. |
| `commands/{operationUuid}` | `id`, `commandId`, `workstationId`, `nodeId`, `action: power_on`, `state`, `createdBy`, `at`, `checkedAt`, `result`. Unique ID reused on retries; linked to committed session. |
| `issues/{autoId}` | `sessionId`, `studentId`, `workstationId`, `description`, `status: open/investigating/resolved`, `remarks`, `resolution`, `createdBy`, `at`, `updatedAt`. Resolution required to resolve. |
| `audit/{uuid}` | `actor`, `action`, `data`, `at`. Server-created, no update/delete API. Includes provisioning, administrative saves, session changes and device-command result changes. Never contains passwords/pairing tokens. |
| `settings/lab` | `welcomeTimeoutSeconds: 10…120`, `updatedAt`. Shutdown policy always returned as false until capabilities exist. |
| `canceledOperations/{operationUuid}` | `actor`, `at`. Staff cancellation tombstone for an uncommitted operation. Prevents a late reservation commit; must not be casually deleted. |

All session, command and audit times use Firestore server timestamp transforms.
Controller observations have separate ISO-8601 UTC device timestamps; synchronize
controller/server clocks. PC monitoring is fetched live, not inferred from a
cached Firestore field. Connectivity diagnostics verify a fresh Firestore read
and independently probe the controller. History dates are Philippine time.

## Permission boundary

* Unauthenticated, anonymous, disabled, unapproved and revoked users: no API data.
* Approved kiosk: fingerprint scan requests (15/minute/IP), safe PC status projection,
  reservation, own operation lookup/reconciliation, explicit active-session
  checkout and issue creation, nonsecret policy read, cloud health read.
* Enabled administrator: the above plus student and workstation management,
  all attendance and export, issue management, audits, settings, reasoned staff
  close/reassignment and cancellation of uncommitted operation IDs.
* Server identity: Firestore Admin SDK writes governed by IAM plus service
  validation, **not by Firestore rules**. The rules alone cannot enforce Admin
  SDK behavior. Unit tests cover the server's transition policy; a live-project
  acceptance pass is still needed.

Kiosk reservation, checkout and reporting require a matched fingerprint request
owned by that account and linked to the session's student. Results expire after
120 seconds. Student-ID lookup is administrator-only. Enrollment and slot
linking remain supervised administrative operations.
