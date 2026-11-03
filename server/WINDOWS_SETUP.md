# Windows development backend with trusted HTTPS

This setup runs the existing Node API on Windows and uses a temporary Cloudflare
Tunnel for an HTTPS certificate trusted by a normal Android tablet. The API still
reaches the ESP32 over the local LAN. No Flutter changes, custom Android CA,
certificate-validation bypass, router port forwarding or public port 8080 is
needed. The tunnel is public; all application routes remain protected by the
existing Firebase authentication and role/approved-kiosk checks.

## Verified local state

* Project supplied by you: `comlab-2ed9d`.
* Computer's Wi-Fi address at inspection: `192.168.1.48` (not an HTTPS URL).
* `comlab-controller.local` resolved to `192.168.1.122`.
* Unauthenticated `http://comlab-controller.local/v1/health` returned 401. This
  verifies DNS and HTTP reachability, not the pairing secret or node protocol.
* Node 24.15.0 and npm are installed; backend dependencies are already installed.
* Official cloudflared 2026.10.7 is installed at
  `server/.local/bin/cloudflared.exe`. Its SHA-256 matched the GitHub release's
  published asset digest. `.local/` is ignored by Git.
* `C:\Users\clima\.comlab-secrets` was created with inheritance disabled and
  access limited to the current Windows account and SYSTEM. No key is present.
* Initial setup has since passed the real Firestore and authenticated controller
  preflight checks, and the user started the API on loopback port 8080.
* A temporary tunnel was created and its HTTPS certificate verification and
  expected ComLab authentication guard passed. The URL for that running tunnel
  is recorded in `server/.local/trusted-api-url.txt`; it becomes invalid when the
  tunnel ends and must be replaced after recreating the tunnel. Authenticated
  tablet end-to-end behavior still requires a separate app sign-in check.
* Automatic approval review rejected starting the background API process with
  only the message "blocked by policy". Use the foreground commands below in
  your own PowerShell terminals after creating the credential.

The original Windows TCP-listener inspection in Start-Https.ps1 produced a false
negative despite a working API. It has been removed; the actual loopback HTTP
probe still requires ComLab's exact unauthenticated 401 response before exposing
the service through the tunnel.

## 1. Prepare your existing Firebase project

The web `firebaseConfig` you provided identifies the project but is not a server
credential. The server does not use the web apiKey, authDomain, web appId,
storageBucket or messagingSenderId.

Open [your Firebase project](https://console.firebase.google.com/project/comlab-2ed9d/overview).

1. Create the **default Cloud Firestore database** if it does not exist. Use
   production mode and an appropriate region. Keep client access denied.
2. Enable **Authentication → Sign-in method → Email/Password**.
3. In Authentication → Users, create one administrator account and one separate
   kiosk account. Choose passwords in the console; do not put them in scripts or
   chat. Copy their UIDs for role provisioning later.
4. Deploy this project's `firestore.rules` and `firestore.indexes.json` using
   your project-owner CLI login. From the ComLab project root:
   ```powershell
   npx --yes firebase-tools login
   npx --yes firebase-tools deploy --only firestore --project comlab-2ed9d
   ```
   The project ID is explicit to avoid touching eSURSECO. Do not deploy with
   permissive test rules. The dedicated server identity below does not need
   permission to deploy rules or create databases.

No Cloud Functions deployment or Blaze upgrade is performed by these scripts.
Review any pricing/plan prompts in the console before accepting them.

## 2. Create the server credential

Use [Google Cloud service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=comlab-2ed9d)
with project `comlab-2ed9d` selected:

1. Click **Create service account**; name it `comlab-windows-api`.
2. Grant **Cloud Datastore User** (`roles/datastore.user`) for Firestore data and
   **Firebase Authentication Admin** (`roles/firebaseauth.admin`) for the supplied
   user-provisioning/revocation CLI and server auth-user checks. Do not grant
   project Owner/Editor. More narrowly scoped custom roles/separate provisioning
   identities can replace these roles later.
3. Finish creation. Open that service account → **Keys → Add key → Create new
   key → JSON**. This requires your project-owner/key-management permission. If
   organization policy blocks keys, use an approved keyless ADC/impersonation
   setup instead; do not work around your organization's policy.
4. Save/move the downloaded JSON as:
   ```text
   C:\Users\clima\.comlab-secrets\comlab-server.json
   ```
   Recheck the file's Security properties: only your Windows account and SYSTEM
   should have access. Remove leftover copies from Downloads. Do not paste the
   file into chat, commit it, or put it in the Flutter app/ESP32.

The launcher checks that it is a service-account file for the matching project
and refuses a credential stored inside the ComLab source directory. The Node
preflight reads it without printing its private key or access tokens.

## 3. Provision administrator and kiosk roles

Use a PowerShell terminal in `C:\Users\clima\Desktop\ComLab\server`:

```powershell
Set-Location 'C:\Users\clima\Desktop\ComLab\server'
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\Users\clima\.comlab-secrets\comlab-server.json'
$env:GOOGLE_CLOUD_PROJECT = 'comlab-2ed9d'
npm run provision -- admin ADMIN_AUTH_UID
npm run provision -- kiosk KIOSK_AUTH_UID
```

Replace the UID placeholders with the actual Authentication UIDs, not email
addresses. These commands write roles/approval plus audit records and revoke
old refresh tokens. Sign in again on the tablet afterwards. There is no public
administrator registration or promotion endpoint.

## 4. Start the backend — terminal A

```powershell
Set-Location 'C:\Users\clima\Desktop\ComLab\server'
npm ci
.\scripts\Start-Dev.ps1
```

The launcher defaults to your real project and the credential path above. It
prompts for the **controller pairing secret**, using hidden input. Enter the same
secret used by the controller firmware and tablet. The secret is not saved to a
file or printed. It is held in the child process environment while the API runs.
Do not use a Firebase password or web API key as the controller secret.

It performs read-only checks against real Firestore, authenticated controller
`/v1/health` and `/v1/nodes`, then starts the API. It sends no relay command.
If a check fails, the API is not started. Keep this terminal open; Ctrl+C stops it.
If PowerShell blocks local scripts, review them first and use a process-scoped
`Set-ExecutionPolicy -Scope Process RemoteSigned` if permitted by your policy;
do not change machine-wide execution policy or bypass organization controls.

Preflight alone:
```powershell
.\scripts\Start-Dev.ps1 -CheckOnly
```

Variables populated by the launcher:

| Variable | Value / purpose |
|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | Absolute path to the protected service-account JSON; server only. |
| `GOOGLE_CLOUD_PROJECT` | `comlab-2ed9d`; must match the credential and Android Firebase project. |
| `CONTROLLER_URL` | `http://comlab-controller.local`; no `/v1` or trailing slash. |
| `CONTROLLER_TOKEN` | Hidden prompt; must match the controller's pairing secret. |
| `CONTROLLER_TIMEOUT_MS` | `4000` by default; launcher range 1000–15000. |
| `HOST` | `127.0.0.1`; API is not exposed directly on Wi-Fi. |
| `PORT` | `8080` by default; configurable with `-ApiPort`. |

`npm start` is `node src/index.js`. The original server reads process environment
variables, **not an automatically loaded `.env` file**. The launcher sets and
restores its own environment. It does not persist these variables system-wide.
TLS verification remains enabled; do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## 5. Start HTTPS — terminal B

Only do this after terminal A starts successfully:

```powershell
Set-Location 'C:\Users\clima\Desktop\ComLab\server'
.\scripts\Start-Https.ps1
```

This verifies that loopback port 8080 is serving the expected ComLab 401 response,
then runs:

```powershell
.\.local\bin\cloudflared.exe tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:8080
```

Cloudflared prints the **actual generated HTTPS URL**. No domain or Cloudflare
account is required for this temporary development tunnel. Its certificate is
publicly trusted; do not install a self-signed certificate or disable validation.
Internet/outbound tunnel access is required on the computer. The tablet also
needs internet. No public URL exists until cloudflared successfully creates one.

The URL changes when the tunnel is recreated and stops working when that process
ends. Do not add browser/email-login Cloudflare Access protection to this API
unless the app is updated to support it; current requests carry Firebase tokens,
not Cloudflare interactive login sessions. Firebase checks still protect every
route. Keep the development tunnel open only as needed.

## 6. Verify and fill the tablet settings

In a third terminal, substitute the URL actually printed by cloudflared:

```powershell
node scripts/check-https.js 'PASTE_THE_ACTUAL_HTTPS_ORIGIN_HERE'
```

This uses normal certificate verification and expects HTTP 401 with ComLab's
authentication message. It prints the exact **Trusted API HTTPS address** only
after the check succeeds. A 401 means the HTTPS path and auth guard work; it is
not proof that an authenticated Firestore request succeeded.

Enter on the tablet:

* **Trusted API HTTPS address:** exactly that printed HTTPS origin, without
  `/health`, `/v1`, `/api`, or a trailing slash.
* **Controller address:** `http://comlab-controller.local`.
* **Pairing secret:** the matching controller secret.
* **Controller timeout:** `4000` ms initially.

Neither `http://192.168.1.48:8080` nor `http://comlab-controller.local` is a valid
Trusted API HTTPS address. The first is a local HTTP API address (and is not bound
to Wi-Fi by this setup); the second is the separate ESP32 controller.

Sign in with the approved kiosk account. Administrator → Settings → Diagnostics
should confirm Firebase via the API and local controller connectivity separately.
An unauthenticated browser request to HTTPS `/health` is expected to return 401.

Your supplied Firebase appId is a **web app ID**, so it must not be used as
`FIREBASE_APP_ID` for Android. If the installed APK is still the original
setup-only build, register Android package `com.comlab.kiosk` in the same Firebase
project, obtain its actual Android identifiers, and rebuild as documented in the
project README. This backend setup does not modify the Flutter configuration.

## Troubleshooting

* **Missing key:** create/save the JSON; web firebaseConfig cannot substitute.
* **Firestore permission denied:** verify project, default database and the
  service account's Cloud Datastore User role. Do not weaken Firestore rules.
* **Controller 401/403:** pairing secret differs from the firmware.
* **Controller DNS failure:** Windows and Android both need to resolve the name;
  router DNS or ESP32 mDNS is needed. A Windows hosts entry alone does not fix
  Android. Recheck after network changes; observed addresses can change via DHCP.
  In this setup, an actual multicast query received the ESP32's mDNS answer for
  `comlab-controller.local` at `192.168.1.122`, and authenticated health/node GETs
  succeeded by IP, while Windows' ordinary hostname lookup returned ENOTFOUND.
  The firmware already calls `MDNS.begin` and advertises the HTTP service.
  A Windows-only development workaround is available without changing firmware:
  open PowerShell **as Administrator** and run
  `& 'C:\Users\clima\Desktop\ComLab\server\scripts\Fix-ControllerHostname.ps1'`.
  This backs up the hosts file, adds only the verified controller hostname/IP
  mapping, clears the DNS cache and checks resolution. It refuses conflicting
  existing entries. Windows protects that file, so administrator elevation is
  required for this one operation. Then return to normal PowerShell and rerun
  Start-Dev.ps1. Reserve the controller's DHCP IP on the router for longer use;
  if its IP changes, review/update this single hosts entry. This workaround does
  not establish tablet-side resolution and sends no power commands.
* **Tunnel 502:** local API is stopped or wrong port; check terminal A.
* **HTTPS certificate error:** verify clock/date and use the actual tunnel
  hostname. Do not substitute an IP or bypass validation.
* **Account not approved:** run the provisioning CLI for the correct UID.
* **Shared rate limits:** existing server does not trust proxy headers, so
  tunneled requests share the loopback-IP rate limits. This is conservative for
  one-tablet development; proxy-aware per-client limits are not configured here.

Official references:
[Firebase Admin setup](https://firebase.google.com/docs/admin/setup),
[service-account keys](https://docs.cloud.google.com/iam/docs/keys-create-delete),
[Firestore roles](https://docs.cloud.google.com/iam/docs/roles-permissions/firestore),
[Firebase Auth roles](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth),
[Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/),
[Android CA trust](https://developer.android.com/privacy-and-security/security-config).
