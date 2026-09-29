# Rammerhead alternative for Novaris

**For this Google Cloud deployment, use [RAMMERHEAD-CLOUD-RUN.md](RAMMERHEAD-CLOUD-RUN.md).**
It includes a separate single-port backend, patched dependency lockfile and header authentication.
The older two-port manual setup and its dependency audit below refer to the original upstream installation.

Rammerhead is added beside Scramjet and Ultraviolet. Existing page structure, styles, fullscreen controls and loaders remain. Engine choices, retry alternatives and the optional status entry are extended. No Cloud Browser permission is required: Rammerhead uses the normal signed-in proxy flow. No VNC, streamed desktop or Docker is needed.

## What must run

Novaris plus a separate upstream Rammerhead Node service. Installing this ZIP alone does not create that service. Rammerhead runs on a different browser origin to keep proxied site scripts separate from Novaris account pages. The Novaris backend alone creates sessions with the private management password; each signed-in user gets a distinct session ID. Do not use a random public proxy or share its password.

The tested upstream dependency installation reported 15 production dependency advisories (13 high, 2 moderate). These are in the separate Rammerhead backend, not new Novaris dependencies. This integration does not resolve those upstream advisories. Start with local testing; review and remediate the backend dependencies before public deployment.

Select Rammerhead on the home page, new-tab cards, onboarding, Tabs or Proxy dropdown, retry screens, or My Account. The Status page reports configuration without claiming the backend is reachable. Existing styling is reused for the additional choices.

## Local test on the same computer

Use Node.js 22 and Git. Keep the backend in a separate folder outside Novaris. These commands check out the upstream revision inspected for this integration:

```bash
git clone https://github.com/binary-person/rammerhead.git novaris-rammerhead
cd novaris-rammerhead
git checkout ee5fbb7837f5fe752c4b82c18184f42449678d5b
npm install --ignore-scripts
npm run build
```

Copy Novaris's deploy/rammerhead/config.cjs to config.js in this backend folder. Upstream is CommonJS, so that filename is intentional. Its shipped lockfile is not consistent with modern npm ci; use the install command above. Dependencies are upstream-owned: review npm audit before exposing the backend publicly.

Create a private .env in the Rammerhead folder:

```dotenv
RAMMERHEAD_PASSWORD=REPLACE_WITH_A_LONG_RANDOM_SECRET
RH_PUBLIC_ORIGIN=http://localhost:8090
RH_CROSS_DOMAIN_PORT=8091
```

You can generate a secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep the value private; use the same value in both server .env files.

In the backend terminal, run `npm start`. Keep it running. In Novaris's existing .env, add:

```dotenv
RAMMERHEAD_API_URL=http://127.0.0.1:8090
RAMMERHEAD_PUBLIC_URL=http://localhost:8090
RAMMERHEAD_PASSWORD=THE_SAME_PRIVATE_SECRET
```

Restart Novaris and open it locally on the same computer, for example http://localhost:8080. Sign in, select Rammerhead, and open a website. Scramjet and Ultraviolet remain available if a website fails. Do not navigate Novaris itself through the proxy.

## Hosted Novaris / Codespaces

localhost always refers to the computer making the connection. A Novaris backend running in Codespaces cannot reach a Rammerhead service on your Windows PC via 127.0.0.1. Likewise, a remote user's browser cannot use your PC's localhost address. For remote use, configure a reachable backend and HTTPS public origin; do not paste localhost settings into a hosted deployment expecting them to reach your PC.

Use a separate hostname, such as rh.example.com, and HTTPS on both its primary and cross-domain ports. The primary backend listens privately on 127.0.0.1:8090 and the cross-domain backend on 127.0.0.1:8091. A reverse proxy should forward public rh.example.com:443 to 8090 and rh.example.com:8443 to 8091, including WebSockets. Then set RH_PUBLIC_ORIGIN=https://rh.example.com and RH_CROSS_DOMAIN_PORT=8443 in the backend, and RAMMERHEAD_PUBLIC_URL=https://rh.example.com in Novaris. Keep RAMMERHEAD_API_URL private when the two services share a machine. If it crosses a network, use HTTPS and access controls.

Do not apply Novaris's same-origin frame restriction to the Rammerhead backend: it must allow embedding from your Novaris origin. Avoid cookies scoped to an entire parent domain; Novaris authentication cookies must not be sent to the proxy hostname. Disable access logging of management query strings, since upstream puts its password in them. Restrict /newsession, /editsession and /deletesession to the Novaris backend at the reverse proxy when publishing the service. Limit backend network access to prevent users reaching private infrastructure through it.

## Sessions and limitations

Session URLs contain a random bearer ID. Anyone who obtains one can use that proxy session: keep URLs private. This is upstream Rammerhead's session model, not a second Novaris-authenticated browser gateway. Existing remote sessions are not instantly invalidated by Novaris logout. The adapter expires sessions after 12 hours and attempts deletion, and backend session-store expiry supplies cleanup after crashes. Upstream's default stale expiry is three days. New Novaris process instances allocate new sessions; there is no promise of profile continuity across Novaris restarts or multiple replicas. Cookies/local storage can be retained during the session by Rammerhead; this is independent of the persistent Cloud Browser profiles.

Because the frame is on a separate origin, Novaris cannot inspect its current document title or follow internal navigation in the address bar. Reload uses the last URL opened through Novaris; in-frame navigation is controlled by the remote page. Some sites, logins, popups and games may fail under rewriting. Rammerhead does not run desktop applications or the Roblox client. Cross-domain operation requires the second port; some restricted hosting environments cannot provide this.

No database migration is required for the shipped schema: its engine/preference columns are text. If you added a custom database CHECK constraint limiting engine names, extend that constraint to include rammerhead.

## Tests

Run npm run test:rammerhead, npm run test:cloud-browser and npm run check from Novaris. Full lint/precommit results and the file manifest are included in the release report. The upstream backend is not bundled into this ZIP and its dependencies are not added to Novaris's package lock.

Upstream source: https://github.com/binary-person/rammerhead
