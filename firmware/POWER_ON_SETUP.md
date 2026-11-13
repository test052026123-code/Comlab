# Guarded kiosk power-on

The workstation node and central controller implement `power_on` separately from
relay diagnostics. Upload the updated node first, then `comlab-cloud-net-12` to
the central controller. Older controllers advertise no power capability and
reject kiosk power-on. Both updated boards must remain powered and on the lab
Wi-Fi. Reset channel GPIO22 is held LOW; reset commands are not implemented.

Controller scan-10 also runs HTTPS in a separate task so transport cannot block
scanner polling. Check-in accepts a freshly captured image even when the finger
was placed before cloud delivery. Enrollment still requires lifting between
its two images. `FINGERSTATUS` reports reader readiness and polling diagnostics.
Status-11 additionally rebuilds telemetry after failed HTTPS exchanges using a
new monotonic sequence and actually recent node samples. This avoids cached
request replays leaving workstations stale. Command IDs, expiry and node journal
deduplication remain unchanged; stale or disconnected nodes stay unavailable.
Net-12 retains those behaviors and adds `NETSTATUS` plus credential-free socket,
TLS, signal and memory diagnostics for investigating intermittent HTTPS failures.

GPIO23 drives the documented 2N2222A interface to relay IN1. GPIO33 reads the
documented isolated PC power-sense module. Power sensing must actually be wired
and `COMLAB_NODE_POWER_SENSE` enabled. The executor checks stable OFF and the raw
GPIO level, journals command identity in NVS before queueing a 300 ms pulse, and
checks raw feedback and command expiry again immediately before driving HIGH.
Only observed ON after the timed release yields `confirmed_on`. Missing feedback
after 20 seconds yields `unknown`; it never automatically retries a pulse.

An accepted command becomes unknown after reboot and cannot pulse again. An
unknown journal blocks new power commands and bench pulses; investigate it
instead of clearing NVS or inventing a fresh command ID. USB OFF remains available.
The journal is separate from the existing diagnostic journal.

For an old unknown command that has been investigated, a local USB operator can
recover the node without erasing NVS. Independently check that the PC is OFF,
send `POWERSTATUS` at 115200 baud, then send
`POWER-RECOVER-OFF <exact-command-uuid>`. The command requires an idle relay,
OFF feedback and an exact match to the unresolved journal entry. It marks that
old attempt rejected while retaining its identity and issue watermark. Recovery
sends no pulse and never permits the old command to replay. Only a newer,
authenticated normal startup command can subsequently request a pulse. This
does not repair a power sensor that fails to follow actual ON/OFF transitions.

## Controller protocol

The existing per-node HMAC and current boot/sequence checks remain mandatory.
The controller's signed heartbeat acknowledgement adds `powerSupported: true`.
Only after receiving that flag does the node add `powerReady` and optional
`powerResult` to heartbeats. This negotiation lets an updated node continue
discovery/bench heartbeats with the old controller during sequential USB uploads.

Acknowledgements may contain `powerCommand` with exactly these six fields:

```json
{
  "commandId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "nodeId": "NODE-01",
  "workstationId": "PC-01",
  "action": "power_on",
  "issuedAtMs": 1800000000000,
  "expiresAtMs": 1800000030000
}
```

Use the original cloud expiry, not a fresh local lifetime on retries. The
current server creates a 30-second lifetime, so `issuedAtMs` can be derived from
that expiry minus 30000. Identity, issue time and expiry must remain unchanged
on repeated delivery. Commands must be newer than the node's persisted issue
watermark. Expired, wrong-target and malformed commands cannot pulse.

`powerResult` contains `commandId`, `issuedAtMs`, and state `accepted`,
`confirmed_on`, `rejected`, or `unknown`. The controller keeps one owned command
per node, scoped to its cloud boot. The server prevents redelivery of that boot's
possibly delivered work after controller restart. The node's persistent journal
prevents physical replay after its own restart. Unresolved work cannot be replaced.

The controller advertises `power_on` only with a fresh, updated executor reporting
known power. It forwards `confirmed_on` only alongside fresh ON telemetry. Delayed
cloud acknowledgements cannot clear newer node results. If startup telemetry ages
during HTTPS retries, the controller refreshes it using a higher sequence without
changing command identity or expiry. A queued bench diagnostic loses further
dispatch when a production power command owns that node; possibly sent diagnostics
are reported unknown, never assumed canceled.

Version 7 drains authenticated heartbeats queued during HTTPS before evaluating
new commands. If a previously ready node's feedback has aged, the command waits
for a fresh sample within its original expiry instead of being immediately
rejected. Dispatch still requires fresh OFF and expires without a pulse if that
feedback never arrives. Results carry a reason, and POWERSTATUS retains the last
completed command and reason until controller restart.

## After uploading both boards

1. Keep both boards powered when the PC is off. USB power from an independent
   adapter can free the computer's USB port.
2. Before a kiosk power-on test, manually turn the PC ON and OFF and verify that
   dashboard power follows both transitions. An unwired GPIO33 pull-up can read
   OFF; seeing OFF alone does not validate the power-sensing circuit.
3. Refresh workstation status. The node must be fresh, mapped correctly and
   enabled, with maintenance off and no conflicting session.
4. A previously rejected command remains terminal and will not retry itself.
   If its session is still active, staff must close that session with a reason
   before scanning and making a new reservation. Never delete command records
   or erase NVS to force another pulse.

Read-only serial diagnostics: `POWERSTATUS` on the controller, `STATUS` on the
node, at 115200 baud with Newline. The bridge update does not itself send a relay
pulse; physical kiosk startup remains a supervised acceptance test.

## Local checks

Run `server/scripts/Test-RelayBench.ps1` for the actual relay timer and power
executor with simulated GPIO, time, JSON fields, and persistent storage. Cases
cover duplicate/reboot suppression, final sensor and expiry guards, NVS failures,
known-ON rejection, timeout without retry, OFF cancellation, corrupt journals,
controller result ownership and delayed acknowledgements. A combined host case
uses the actual controller lifecycle and node executor and counts one simulated
GPIO pulse despite repeated delivery.
These tests do not measure physical relay contacts or validate real sensing wiring.

Build using `server/scripts/Build-Firmware.ps1 -Target node`, then upload using
`server/scripts/Upload-Node.ps1 -NodePort COMn`. Helpers support the installed IDE
or a local CLI/configuration under ignored `server/.local/toolchain`.
Keep relay contacts disconnected for firmware uploads and initial diagnostics.

