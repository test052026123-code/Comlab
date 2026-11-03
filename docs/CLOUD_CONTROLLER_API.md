# Implemented outbound controller protocol, version 1

Source: `server/src/cloud-controller.js`, `server/src/device-auth.js`,
`server/src/index.js`, `firmware/comlab_cloud/comlab_cloud.ino`.
The deployed origin passed process-health and unauthenticated guard checks;
approved-user/Firebase access and physical hardware remain unverified. The
existing LAN protocol remains in `CONTROLLER_API.md`.

Cloud mode: tablet -> HTTPS Node API -> Firestore queue <- ESP32 outbound HTTPS.
The tablet never submits cloud commands directly to the controller. The server
does not resolve `comlab-controller.local` in this mode.

## HTTP endpoints

All URLs use the actual deployed HTTPS origin. JSON bodies use
`Content-Type: application/json`. Maximum request body: 16 KiB.

| Method/path | Authentication | Purpose |
|---|---|---|
| `GET /healthz` | None | Process liveness only; `{"status":"ok"}` |
| `GET /health` | Firebase ID bearer token, approved admin/kiosk | Real Firestore read; `firebase`, `controllerTransport`, `at` |
| `GET /controller/status` | Same Firebase approval | Last cloud controller connection summary |
| `GET /workstations` | Same Firebase approval | Five configured workstation records, node telemetry, eligibility |
| `POST /reserve` | Same Firebase approval | Atomic session and command creation |
| `GET /operations/:uuid` | Creating kiosk or admin | Session plus command/result |
| `POST /operations/:uuid/reconcile` | Creating kiosk or admin | Read stored controller result; never sends a pulse |
| `POST /v1/controller/sync` | Device bearer key and controller ID header | Telemetry, result upload, command delivery |

Device headers are `Authorization: Bearer <64-hex-device-key>` and
`X-ComLab-Controller-Id: LAB-CONTROLLER`. The server stores only the SHA-256 hash
of that exact textual key. Device credentials do not grant user/admin API access;
Firebase credentials do not grant device access. Device sync: 60 requests/minute
per IP. User API: 180/minute per IP, with additional lookup limits. Missing/wrong
credentials: 401; unapproved Firebase user: 403; invalid data: 400; conflicting
sequence/clock/result: 409; throttling: 429. Error body: `{"error":"..."}`.

Example authenticated health response:

```json
{"firebase":"reachable","controllerTransport":"cloud","at":"2026-11-04T00:00:00.000Z"}
```

Example controller status before any telemetry:

```json
{"transport":"cloud","controllerId":"LAB-CONTROLLER","connected":false,"receivedAt":null,"sampledAt":null,"firmwareVersion":null,"reportedNodes":0}
```

## Sync request and response

All top-level and nested fields below are required unless marked optional.
Unknown fields are rejected. Generate a fresh UUID bootId at each ESP32 restart.
Start sequence at 1, increment after an acknowledged successful response.

```json
{
  "protocolVersion":1,
  "bootId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "sequence":1,
  "sampledAt":"2026-11-04T00:00:00.000Z",
  "uptimeMs":5000,
  "firmwareVersion":"comlab-cloud-connection-test-1",
  "capabilities":[],
  "nodes":[],
  "results":[]
}
```

This is what the controller reports before observing any node. The updated
discovery firmware reports authenticated node heartbeats with power unknown;
it still advertises no power capability. See [node setup](../firmware/NODES_SETUP.md).
Example response with no work:

```json
{
  "protocolVersion":1,
  "controllerId":"LAB-CONTROLLER",
  "bootId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "ackSequence":1,
  "serverTime":"2026-11-04T00:00:00.100Z",
  "acknowledgedResults":[],
  "commands":[]
}
```

The implemented server also accepts real node reports, for a future hardware
executor. Example node (not emitted by the current sketch):

```json
{"workstationId":"PC-01","nodeId":"NODE-01","connectivity":"connected","power":"off","reachability":"unknown","input":"unknown"}
```

Allowed workstation IDs: PC-01 through PC-05. Node IDs: uppercase A-Z, digits,
underscore or dash, length 1-40, first character alphanumeric. Each node and PC
mapping must be unique. At most five nodes, five results and five returned
commands. Connectivity: connected/disconnected. Power: on/off/unknown.
Reachability: reachable/unreachable/unknown. Input: active/idle/unknown.
Capabilities is empty or `["power_on"]`; only advertise implemented hardware.
Firmware version: 1-64 characters. Sequence: positive safe integer; uptime:
nonnegative integer. sampledAt: ISO-8601 UTC timestamp; clocks must synchronize.

An example `/workstations` item includes the node fields above plus `observedAt`
and an `eligible` boolean, alongside configured PC fields. Missing/stale telemetry
produces unknown power and an ineligible PC. Controller receipt and sample age
must both remain below 15 seconds. Receipt alone never refreshes an old sample.

## Commands and results

Example reservation body:

```json
{"operationId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","studentId":"20261122","workstationId":"PC-01"}
```

The operation UUID is also the command UUID when power-on is necessary. A retry
with the same ID and identity returns the existing session; conflicting identity
is rejected. Reserving a PC already known ON does not create a power command.
The operation response contains `session` and `command`; a cloud command includes
`delivery:"cloud"`, `controllerId`, identity and `state:"pending"`.
The app waits/reconciles through the API and never falls back to LAN delivery.

If a hardware-capable controller reports a fresh connected OFF node matching the
reserved PC, a sync response may contain this command:

```json
{"commandId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","workstationId":"PC-01","nodeId":"NODE-01","action":"power_on","expiresAt":"2026-11-04T00:00:30.000Z"}
```

Command expiry is 30 seconds after queue creation. Only power_on is implemented
by the server protocol. No shutdown endpoint or automatic power-off exists.
Next sync can upload:

```json
{"commandId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","workstationId":"PC-01","nodeId":"NODE-01","action":"power_on","state":"accepted","detail":"Optional explanation, at most 160 characters"}
```

States: pending, accepted, confirmed_on, failed, rejected, unknown. Acknowledgement
does not prove ON. confirmed_on requires a fresh report in that same sync with
matching connected node and actual ON feedback. Terminal confirmed_on/failed/
rejected states cannot change. Accepted cannot regress to pending. Result
identity and delivery boot must match. The response lists received result IDs
in acknowledgedResults. Keep unacknowledged results for retry.

Lookup via `GET /operations/<uuid>` returns, for example (other session/command
metadata is also included):

```json
{"session":{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","status":"active","workstationId":"PC-01"},"command":{"commandId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","delivery":"cloud","state":"accepted","result":{"commandId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","workstationId":"PC-01","nodeId":"NODE-01","action":"power_on","state":"accepted"}}}
```

## Retry, trust and missing hardware behavior

Current firmware validates public CA trust and HTTPS hostname through the ESP-IDF
certificate bundle, disables redirects, waits for SNTP time, and uses an 8-second
HTTP timeout. Nominal sync interval is 5 seconds plus up to 249 ms jitter;
failed exchanges back off to 10, 20, then 30 seconds. Failed requests retain the
same body and sequence. An identical latest sequence returns its cached reply
without updating freshness; conflicting/older sequences and retired boots get
409. A sample over two seconds ahead is rejected. The connection-test firmware
logs failures and retries; a persistent sequence conflict needs diagnosis/reset.

Unacknowledged deliveries can repeat the same UUID within the same boot before
expiry. Acknowledged work is not dispatched again. After a new boot, previously
delivered unresolved work becomes unknown and is never replayed. Expired
undelivered work is rejected; possibly delivered work becomes unknown. Do not
release a reservation or repeat a physical pulse based on a timeout alone.

**Implemented in the updated firmware:** authenticated local Wi-Fi node
heartbeats and forwarding of observed connectivity through the cloud controller.
The node also has a separate, locally armed [USB relay bench test](../firmware/RELAY_TEST.md).
**Not implemented:** power sensing, cloud-command relay execution, and persistent
NVS command deduplication. Every cloud power command is rejected; this protocol
does not drive a relay. A future executor must persist
command identity before any physical pulse, return stored results for duplicates,
check expiry/feedback, and recover without repeating a pulse after reset.
Those requirements are proposed hardware behavior, not an already-tested relay
implementation. No deployed end-to-end or physical power test has been performed.
