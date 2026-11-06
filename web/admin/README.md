# ComLab Admin — GitHub Pages

Dashboard: https://test052026123-code.github.io/Comlab/

The static React application deploys from `main` using
`.github/workflows/admin-pages.yml`. GitHub Pages must use the GitHub Actions
publishing source. `vite.config.ts` sets the repository base path `/Comlab/`.

The login page is public; all student, attendance and administrative records
require Firebase authentication and approval as an administrator by the existing
trusted API at `https://comlab-api.onrender.com`. There is no public signup.
Firebase Web configuration is public. Service-account and controller credentials
must never be added here. Tokens live only in browser memory, refresh before
expiry, and are cleared on reload/sign-out. No direct Firestore access is used.

Deploy the API change in `server/src/admin-web.js` on Render alongside this
website: its CORS policy allows only `https://test052026123-code.github.io`,
supports bearer/JSON preflights, and preserves native app/device requests with
no Origin header. CORS does not replace server-side authentication or role checks.
The site does not use the former Sites Worker proxy.

Use your existing ComLab administrator email/password. Manage students and
fingerprint-slot links, workstation availability and confirmed relay tests,
attendance/CSV exports, issues, audit records, and lab settings. Fingerprint
templates remain on the AS608; enroll through USB first and link the slot here.
Unknown relay/operation results must be checked before starting a new action.

Development: Node 24, `npm ci`, `npm run dev`, `npm run build`.
For browser QA, run `node test/browser.mjs <absolute-path-to-playwright-core/index.mjs>`
with Chrome and a local dev server. The test intercepts all Firebase/API requests
with synthetic data, so it cannot mutate live students or pulse physical relays.
Screenshots are written to ignored `outputs/`.
