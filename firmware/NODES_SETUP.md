# Workstation node discovery firmware

This version implements authenticated node heartbeats on the laboratory Wi-Fi.
It does not execute relay commands or sense PC power. It never reports a PC OFF
or ON based on a relay command or network reachability. Power, reachability and
input remain unknown, and PCs remain ineligible for check-in.

## Which board gets which sketch

- Central ESP32: `comlab_cloud/comlab_cloud.ino` (updated receiver + Render sync).
- Separate ESP32 at PC-01: `comlab_node/comlab_node.ino`.

The two sketches are separate programs for separate boards. Upload the updated
controller first. The earlier connection-test controller cannot receive nodes.
Use Arduino ESP32 core 3.3.7, ArduinoJson 7, DOIT ESP32 DEVKIT V1, Serial Monitor
115200 baud. Do not assume both boards use COM5; select the port for the intended
board. No firmware has been uploaded automatically by these source changes.

## Local configuration

PC-01 / NODE-01 has already been configured locally on this computer. Keep each
sketch's existing ignored secret header alongside its source files. Never move
Firebase Admin JSON into either sketch.

From the ComLab project root, configure each additional node before compiling
and uploading it:

```powershell
node server/scripts/configure-node.js 1
```

Use slots 1 through 5, mapping exactly:

| Slot | Workstation | Node |
|---|---|---|
| 1 | PC-01 | NODE-01 |
| 2 | PC-02 | NODE-02 |
| 3 | PC-03 | NODE-03 |
| 4 | PC-04 | NODE-04 |
| 5 | PC-05 | NODE-05 |

This reuses controller Wi-Fi settings and generates/reuses five independent
node pairing keys stored in `%USERPROFILE%\.comlab-secrets\node-pairing.json`.
It writes ignored `comlab_node/secrets.h` for the selected node and ignored
`comlab_cloud/node_secrets.h` for the controller. No secret is printed. The
node never receives the Render device key. Keep the protected pairing registry
when configuring another slot; replacing its keys requires reflashing the
controller and affected nodes. Do not run multiple active nodes with the same ID.

The controller registry contains all five slots from the first configuration,
so changing only the selected node slot does not require another controller
upload. The node sketch folder holds one active slot configuration at a time:
compile/upload it before selecting the next slot.

## Expected behavior

Both boards connect to the existing Wi-Fi and synchronize their clocks. Nodes
discover `comlab-controller.local` using mDNS, send a signed heartbeat every
three seconds, and verify signed acknowledgements. Router client isolation
must permit local communication; allow mDNS and local UDP 9090/9091.

Expected node log:

```text
[Node NODE-01 / PC-01] Controller acknowledged heartbeat. PC power: unknown. Relay control disabled.
```

Expected controller log after an actual node heartbeat:

```text
[Nodes] NODE-01 / PC-01 connected. Power remains unknown.
[Cloud] Authenticated HTTPS sync acknowledged; 1 observed workstation nodes reported. Power control disabled.
```

Those are expected messages, not claims of a physical test. In the app, create
PC-01 manually and map it to NODE-01 using the approved administrator. A real
heartbeat can show connectivity, while power stays unknown and selection stays
disabled. Unseen nodes are never invented. Previously observed nodes become
disconnected when their authenticated samples expire.

## Implemented LAN protocol and limits

UDP envelopes contain exactly `body` (serialized JSON string) and `signature`
(lowercase HMAC-SHA256 hex), at most 1024 bytes. Keys are 64-character random hex
strings used as textual HMAC keys, separate for every node. HMAC input is
`comlab-node-report-v1\n` plus the exact body for a report, or
`comlab-node-reply-v1\n` plus the exact body for an acknowledgement. The separate
domains prevent report/acknowledgement substitution. The shared `NodeAuth.h`
copies must remain identical in both Arduino sketch folders.

Report fields: protocolVersion (1), nodeId, workstationId, bootId (32 hex),
sequence (positive uint32), uptimeMs (uint32), sampledAtMs (Unix milliseconds),
power/reachability/input (all literal unknown in this discovery version).
Reply fields: protocolVersion (1), nodeId, bootId, ackSequence. Reports and
replies are authenticated but not encrypted; they contain no passwords,
Firebase credentials, student data or pairing keys.

The controller validates the pairing/mapping, signature, schema, clock skew
(at most two seconds ahead) and sample age (under six seconds for connected
status). Sequence/boot checks reject stale/conflicting reports in memory;
duplicates do not refresh connectivity. Controller cloud payload timestamps use
the oldest connected node's sample, preserving freshness rather than re-dating
cached data. Cloud retries keep their original payload and timestamp.

LAN reception currently shares the controller loop with blocking outbound HTTPS.
During an HTTPS timeout or Wi-Fi loss, heartbeats/acknowledgements can be delayed
or dropped and nodes can temporarily appear offline. That fails closed. This is
a discovery prototype, not a real-time relay executor. Cloud TLS certificate and
hostname validation remain enabled.

## Still required for PC startup

Confirm the relay coil voltage, input polarity, transistor pinout and interface
wiring. Fit the required resistors and use isolated dry contacts across the
motherboard PWR_SW pair. Disconnect relay/PC wiring during this discovery test:
the node does not configure or drive GPIO23. Actual power sensing, relay pulse
execution, persistent command deduplication and physical validation remain
future work. There is no test mode that fabricates OFF/ON telemetry or unlocks
workstation eligibility.
