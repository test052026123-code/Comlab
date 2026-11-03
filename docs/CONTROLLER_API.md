# ComLab controller HTTP contract v1

Firmware is **not included or hardware-verified**. Implement the following API
on the controller ESP32. Both the tablet and trusted API host must reach it.
Only normal `power_on` is supported. Five workstation ESP32 nodes coordinate
through this controller; workstation-node protocol is firmware work.

All requests use `Authorization: Bearer <random-pairing-secret>` and JSON.
Provision at least 32 random bytes through a physical/admin pairing procedure.
Store it securely on the controller, the trusted host environment and Android
secure storage. Compare in constant time, reject unauthenticated calls and
rate-limit. Never log it. Rotate on compromise. The app has a configured
1–15 second timeout and at most two initial POST attempts with identical IDs.
Read reconciliation never resubmits. Firmware must not issue a pulse on GET.

Prototype origin: `http://comlab-controller.local`, exact host exception only.
Provide router DNS or ESP32 mDNS; HTTPS with a trusted certificate is preferred.
HTTP bearer credentials are visible to someone monitoring the LAN: the initial
prototype requires an isolated laboratory network. Both origins use `/v1`.

## Health and node status

`GET /v1/health` → `200`:

```json
{"status":"ok","protocolVersion":1,"controllerId":"LAB-CONTROLLER","time":"2026-11-03T04:00:00Z","capabilities":["power_on","persistent_command_dedup","power_feedback"]}
```

`GET /v1/nodes` → `200`:

```json
{"nodes":[{"workstationId":"PC-01","nodeId":"NODE-01","connectivity":"connected","power":"off","reachability":"unknown","input":"unknown","observedAt":"2026-11-03T04:00:00Z"}]}
```

The example is a contract example, never a seeded app record. Return actual
observations for every configured node. States:

| Field | Values | Source |
|---|---|---|
| `connectivity` | `connected`, `disconnected`, `stale` | Node heartbeat |
| `power` | `on`, `off`, `unknown` | Actual power/monitor feedback |
| `reachability` | `reachable`, `unreachable`, `unknown` | Network reachability |
| `input` | `active`, `idle`, `unknown` | Windows-client telemetry, otherwise unknown |
| `observedAt` | UTC ISO-8601 timestamp | Timestamp of actual power/node observation |

Never refresh `observedAt` just because this endpoint was called. Reports older
than 15 seconds or with future/invalid timestamps are ineligible. Connected
relay hardware alone does not prove PC power state. Ping failure does not imply
OFF; idle does not mean available. Without power feedback the workstation cannot
be assigned. Maintain synchronized clocks (NTP); surface unknown on clock faults.
Unknown fields must stay unknown until a real sensor/agent provides them.

## Submit a power-on command

`POST /v1/commands`:

```json
{"commandId":"53fd1938-2d5e-4091-841b-404902f65307","workstationId":"PC-01","nodeId":"NODE-01","action":"power_on"}
```

`202` accepted response (all result responses repeat the same identity):

```json
{"commandId":"53fd1938-2d5e-4091-841b-404902f65307","workstationId":"PC-01","nodeId":"NODE-01","action":"power_on","state":"accepted"}
```

Firmware MUST:

1. Authenticate; validate action, workstation/node mapping, fresh connectivity,
   and power feedback before energizing a relay. Reject unsupported actions.
2. Persist command ID **before any pulse**; atomically bind its exact payload.
   Same ID / same payload returns existing result, never another pulse. Same ID
   with different payload returns `409`. Persist deduplication across controller
   and node restarts, with node-level deduplication as well. Do not discard
   pending IDs on a timer. Retain terminal IDs for the life of the prototype or
   use an authenticated archival/epoch protocol; archived IDs must never execute.
3. Check current power immediately before execution: if already ON, return
   `confirmed_on` with **no pulse**. If UNKNOWN/disconnected/stale, reject without
   pulsing. This check is necessary even if reservation observed OFF earlier.
4. For confirmed OFF only, send one safe normal power-button pulse. Firmware
   owns relay pulse duration and electrical isolation, validated for each PC.
5. Treat acceptance as queueing, not startup. After real sensor feedback reports
   ON, publish `confirmed_on`. A lost acknowledgment must not queue a new pulse.
6. After a crash or uncertain execution, retain `unknown` until reconciled. Never
   report `failed` solely because no acknowledgment or ping was received.
7. `failed` and `rejected` are terminal and guarantee that no queued or delayed
   pulse can execute later. The app may release a PC only after a terminal result.
   Never transition a terminal failure into an executing command.

## Reconciliation

`GET /v1/commands/{commandId}` → `200` (same identity fields):

```json
{"commandId":"53fd1938-2d5e-4091-841b-404902f65307","workstationId":"PC-01","nodeId":"NODE-01","action":"power_on","state":"confirmed_on","observedAt":"2026-11-03T04:00:08Z","detail":"Power feedback confirmed ON"}
```

States: `accepted`, `pending`, `confirmed_on`, `rejected`, `failed`, `unknown`.
Not found returns `404`, which the trusted server treats as unknown delivery,
never evidence that the PC can be released. The server validates identity fields
before committing results to Firestore. For `unknown`, no safe execution claim
exists; the reservation stays held. Provide an authorized firmware/service
reconciliation procedure for abandoned unknown commands, ensuring any queued
pulse is disabled before declaring a terminal failure. There is no app-side
"force release unknown" workaround.

Other errors: `400` invalid input, `401` missing/invalid pairing token, `403`
pairing not approved, `409` conflict/mismatch, `503` temporarily unavailable.
Return `{"error":"actionable message"}`. Prevent unauthenticated LAN clients
from triggering relays. The shared pairing token authorizes the whole tablet;
it does not prove a human's identity. A compromised paired tablet remains a
device-command risk; signed per-reservation capabilities are a future hardening
option, and are not claimed as implemented here.
# Cloud transport alternative

The new outbound Render transport is documented in
[CLOUD_CONTROLLER_API.md](CLOUD_CONTROLLER_API.md). The LAN API below remains
available in LAN mode. Do not mix device cloud credentials with LAN pairing.
