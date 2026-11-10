# Render deployment

Status: cloud-mode source and local checks are complete. The deployed origin
`https://comlab-api.onrender.com` passed HTTPS `/healthz` (200) and unauthenticated
user/device endpoint guards (401). Approved-user/Firebase access and hardware
connection are not yet verified by this deployment procedure. The updated
[node discovery firmware](../firmware/NODES_SETUP.md) can forward signed local
node heartbeats, but it never changes GPIO or powers a PC. Node power stays
unknown until feedback hardware and command execution are implemented.

## Create the service

Push this source to `https://github.com/test052026123-code/Comlab.git` without
private configuration. In Render choose **New > Blueprint**, connect that
repository, and review `render.yaml`. Alternatively create a Node Web Service
with root directory `server`, build `npm ci --omit=dev`, start `npm start`, and
health-check path `/healthz`. Render supplies `PORT`; the server binds
`HOST=0.0.0.0`. Managed HTTPS replaces the temporary Windows tunnel.

Set these environment variables (the Blueprint already sets fixed values):

| Variable | Value |
|---|---|
| `NODE_VERSION` | `24.15.0` |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `TRUST_PROXY_HOPS` | `1` for the Render ingress; review if adding another proxy |
| `CONTROLLER_TRANSPORT` | `cloud` |
| `CONTROLLER_ID` | `LAB-CONTROLLER` |
| `GOOGLE_CLOUD_PROJECT` | `comlab-2ed9d` |
| `GOOGLE_APPLICATION_CREDENTIALS` | `/etc/secrets/firebase-admin.json` |
| `CONTROLLER_DEVICE_KEY_SHA256` | Value from the protected hash-only file below |

In Render **Environment > Secret Files**, add `firebase-admin.json` using the
existing protected server service-account JSON at
`C:\Users\clima\.comlab-secrets\comlab-server.json`. Never add this file to Git,
the mobile app, firmware, build logs, or chat. Use an identity with only the
Firestore and Firebase Auth permissions required by the existing backend.
Existing approved account documents remain in the same Firebase project; moving
the backend does not create or approve new accounts.

The new device key is separate from the old LAN pairing secret. To create/reuse
it, run from `server`:

```powershell
node scripts/create-controller-key.js
```

The protected folder `%USERPROFILE%\.comlab-secrets` contains
`controller-cloud.json` (private device credential) and
`controller-cloud-sha256.txt` (hash to paste into Render's environment field).
Do not paste either file into chat. The server only needs the hash.
Cloud mode does not use `CONTROLLER_URL` or `CONTROLLER_TOKEN`.

Deploy after adding both secrets. If the Blueprint's first attempt starts before
the secret file exists, add the file and redeploy. Copy the **actual HTTPS service
origin from Render**. The verified current origin is recorded at the top of this
document; placeholder arguments below must be replaced with that actual origin.

## Verify and connect

For a stale/read-only admin dashboard, inspect `request_failed` log entries.
They include the route template and a sanitized SDK code without request bodies,
tokens, student identifiers, or raw credential errors. Numeric gRPC code 7 means
permission denied, 8 resource exhausted, 14 unavailable, and 16 unauthenticated.
The older `ComLab request failed (503)` message alone cannot identify the cause.
Do not change Firestore client rules to repair Admin SDK access.
The proxy setting fixes the forwarded-header rate-limit warning separately;
it does not establish or repair the cause of a backend 503.
Source changes must be deployed on Render before these diagnostics appear.

1. Open the actual origin plus `/healthz`: expect `{"status":"ok"}`.
2. Open `/health` without a token: expect HTTP 401. This is the access guard,
   not proof that a kiosk is approved or that the controller is connected.
3. Install cloud-compatible APK build 11 or newer. The current app fixes the
   trusted API to `https://comlab-api.onrender.com`; no address entry is needed.
   Sign in with the approved administrator. If a future deployment uses a
   different origin, update `LabState.trustedApiUrl` and rebuild first.
4. With authenticated diagnostics, verify Firestore and `/controller/status`.
   The controller will remain offline until the configured sketch is uploaded.

After verifying the real URL, configure firmware locally (replace the first
argument with that actual origin):

```powershell
node scripts/configure-cloud-firmware.js '<ACTUAL_RENDER_HTTPS_ORIGIN>' 'C:\Users\clima\Documents\comlab\comlab.ino'
```

This copies Wi-Fi definitions from the existing sketch and writes the new URL
and device key into ignored, protected `firmware/comlab_cloud/secrets.h` without
printing them. Compile `firmware/comlab_cloud` using Arduino ESP32 core 3.3.7,
ArduinoJson 7, board `esp32:esp32:esp32doit-devkit-v1`. Upload only after reviewing
the connection-test limitation. The original LAN sketch is unchanged.

## Limits and deployment safety

The server uses Firestore for durable commands; local Render disk is not the
database. One controller and five workstation IDs are supported. TLS certificate
and hostname validation remain enabled on Android and ESP32. No inbound port
forwarding or Windows hosts entry is required for the outbound design.

The Blueprint selects Render's Free plan for development. Free services can
sleep after inactivity and take time to wake, exceeding the firmware's 8-second
request timeout and 15-second telemetry freshness window. Do not promise instant
availability or production reliability on that plan. Real telemetry also incurs
Firestore reads/writes at roughly five-second intervals; monitor quotas and
costs. A paid plan is a separate user decision.

Actual relay control, node sensing, durable firmware command deduplication,
hardware acceptance testing, and an end-to-end deployed acceptance pass are
still required. A successful connection test does not mean PCs can start.

Official references: [Web services](https://render.com/docs/web-services),
[environment and secret files](https://render.com/docs/configure-environment-variables),
[Free service limits](https://render.com/docs/free).
