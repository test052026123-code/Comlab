# App to central to node relay bench test

This is a diagnostic relay test with **no PC or other load connected**. It does
not require PC power sensing and does not make a workstation selectable.

## Use

1. Deploy the updated API (`/healthz` reports `apiVersion: node-bench-2`).
2. Upload the updated `comlab_cloud` to the central board (confirmed COM5) and
   `comlab_node` to NODE-01 (originally COM3; now COM4 after reconnecting).
   Keep existing secret headers and verify the current ports before uploading.
3. Install app build 15. In **Admin → Workstations**, choose **Test node relay**
   below PC-01, then **Test relay (300 ms)**.
4. Expect one relay activation/release. The dialog reports the node result:
   `pulse_finished`, `rejected`, or `unknown` if delivery was not confirmed.
   A reported GPIO release does not measure contact continuity; listen for the
   click or verify COM/NO with a meter.

The remote button needs no USB ARM command. Existing USB ARM/TEST/OFF commands
still work; OFF also cancels a queued/active remote pulse. All GPIO23 pulses use
the existing 2N2222A interface and independent timer. There is a three-second
cooldown and each remote pulse returns to LOW after approximately 300 ms.

## Protocol and storage

The authenticated administrator API creates a UUID-keyed `relayBenchTests` record
and a controller pointer in `relayBenchControllers`. Requests expire in 30 seconds.
The API checks that the workstation is unassigned and the central/node report
fresh remote-test support. Unknown PC power is allowed for this diagnostic only.
Student/kiosk accounts cannot create or read relay tests.

Central HTTPS sync carries `benchSupported`, `benchNodes` and optional
`benchResult`. The response adds `benchCommand` and `acknowledgedBench`.
Central embeds the command in the matching node's signed heartbeat reply. The
node verifies the HMAC, current boot/sequence, action, target identity and time
window. Its signed heartbeat returns `benchReady` and optional `benchResult`.
The central forwards that result to the cloud and the app polls the result.

The node writes a command journal to NVS **before** requesting a pulse. Duplicate
UUIDs and commands older than its recorded issue-time watermark cannot pulse
again, including after a reset. Interrupted work remains unknown. New explicit
tests use new UUIDs; transport retries retain the existing UUID. Do not erase NVS
to troubleshoot delivery. A storage or timer failure disables remote testing.

The regular power-control capability remains empty. No reservation, attendance
record, ON/OFF telemetry or PC power command is created by this test. Closing the
test dialog does not cancel a command already sent. Expired pending delivery is
shown as unknown, and is not dispatched again after expiry.

## Verified bench result

On 2026-11-07, the updated API was deployed and both ESP32 boards were uploaded.
A maintenance diagnostic using the trusted server identity queued command
`fb7d1016-45df-40ef-9aa2-785bab5401df`. NODE-01's journal reported the pulse
finished (state 2) with GPIO23 LOW, and the cloud returned `pulse_finished`.
This verifies the cloud/central/node/result path; it does not measure relay
contact continuity. This was a backend maintenance diagnostic, not a tablet tap.
An earlier test expired without reaching the node journal and was not replayed.

Useful read-only serial commands: `BENCHSTATUS` on the central and `STATUS` on
the node. The central retains expired command identity for matching late signed
results, while the expiry check still prevents delayed dispatch.
