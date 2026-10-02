# Cloud Browser: Windows PC + Novaris on Cloud Run

This adds a separate Neko/WebRTC Chromium host to the existing Cloud Browser page. Novaris Cloud/Moonlight remains separate. No VNC is used in this host.

## Start here: your PC only

1. Extract **Novaris-Browser-Host-Windows.zip** somewhere permanent on your Windows PC, such as `C:\Users\dvest\Documents\Novaris-Browser-Host`. Open its `browser-host` folder in File Explorer, right-click an empty area and choose **Open in Terminal**.
2. Keep Docker Desktop running in **Linux containers** mode. Install Node.js 22 if `node --version` is unavailable. The host needs no npm install and no Supabase keys.
3. In that PowerShell terminal run:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\Setup.ps1
   powershell -NoProfile -ExecutionPolicy Bypass -File .\Start.ps1
   ```

   The first command builds a browser image and generates `host-config.json`. The second starts the host on `127.0.0.1:8092`. Leave its window open. The existing manual browser on port 8090 can stay running during this test, but consumes additional RAM.

   The default is **one browser at a time**, with media address `127.0.0.1` for testing from this same PC. More accounts can be enabled, but only one can run until you raise the limit.

4. Add the tunnel route in the next section, deploy the website patch, then configure Cloud Run. After those three steps, open **Cloud Browser → Open my browser** on Novaris, using this same Windows PC. The page should embed Chromium and sign into the stream automatically using your Novaris account.

## Connect your existing Cloudflare tunnel

Your Windows Cloudflared service reads **`C:\Cloudflared\config.yml`**. Keep a copy before editing it. Add this ingress entry **before** the final `http_status:404` entry:

```yaml
  - hostname: browser-host.fuzzthehuzz-ebsfiygfhsvfbfesg.com
    service: http://localhost:8092
```

Leave the existing `cloud.` entry for Moonlight unchanged. The new service is **http**, not https.

Create a DNS CNAME in Cloudflare:

- Name: `browser-host`
- Target: `998182e2-6e18-4fdb-bd24-d09eaedbc26c.cfargotunnel.com`
- Proxy: enabled

Restart the existing service in an **Administrator PowerShell**:

```powershell
Restart-Service Cloudflared
```

Opening `https://browser-host.fuzzthehuzz-ebsfiygfhsvfbfesg.com` should return **Unauthorized**. That is expected: the host accepts only secret-authenticated website requests. A 502 instead means the local agent is stopped or the route is wrong. Do not put an interactive Cloudflare Access login in front of this hostname; Novaris uses server-to-server requests.

## Install the website changes in Codespaces

Download the patch ZIP and drag it into the root of your Codespace. In its terminal:

```bash
cd /workspaces/FuzzTheHuzz
unzip -o Novaris-Cloud-Browser-Patch.zip -d .
npm ci
npm run check
npm run test:cloud-browser
npm run test:browser-host
npm run test:rammerhead
```

The patch has files at the root, so it does not create another project folder. It does not contain `.env` or private keys. Review and commit the files, then deploy through your normal Novaris deployment workflow. A commit deploys automatically only if your existing Cloud Run build trigger is connected to that branch.

Alternatively, the full-project ZIP contains `FuzzTheHuzz-Beta/`. Use either the full project or the patch, not both. Keep your existing server secrets/settings.

## Configure Cloud Run once

In **Google Cloud Shell**, use the updated project's folder and run:

```bash
bash deploy/browser-host/configure-cloud-run.sh
```

If the source is only in Codespaces, upload this script to Cloud Shell first and run `bash configure-cloud-run.sh` from its location.

Enter:

1. Host URL: `https://browser-host.fuzzthehuzz-ebsfiygfhsvfbfesg.com`
2. Website URL: `https://novaris-905797448932.us-south1.run.app` (or the exact address you actually use to open Novaris).
3. Key: open the private `host-config.json` on Windows and paste **only the value of `key`**, without quotation marks. Input is hidden.

The script creates/updates a Secret Manager secret, grants the existing Novaris runtime service account access to that secret, and updates these settings on `novaris` in `fuzzthehuzz-499122 / us-south1`:

```text
CLOUD_BROWSER_ENABLED=true
CLOUD_BROWSER_HOST_URL=https://browser-host.fuzzthehuzz-ebsfiygfhsvfbfesg.com
CLOUD_BROWSER_HOST_KEY=<Secret Manager reference>
CLOUD_BROWSER_PUBLIC_ORIGIN=https://novaris-905797448932.us-south1.run.app
```

It preserves the other environment variables, including Supabase and Rammerhead, and raises the Cloud Run request timeout to one hour for signaling WebSockets. Cloud Run and Secret Manager usage can incur charges. This does not purchase a GPU server or move Chromium off your PC.

The public origin is exact: using another alias requires updating that setting, otherwise stream requests from the other alias will be rejected. The `CLOUD_BROWSER_IMAGE` and `CLOUD_BROWSER_NETWORK_READY` variables belong to the older Linux deployment and are not used when `CLOUD_BROWSER_HOST_URL` is set.

## Test before enabling someone else

1. Enable Cloud Browser for your account in the existing control panel.
2. Launch on the same Windows PC. Type a URL in Chromium, create a bookmark, and end the session with **End session**. Launch again and confirm the bookmark remains. Test a non-sensitive login if desired; some sites intentionally expire their own sessions.
3. Confirm normal Games, proxy choices, fullscreen and Novaris Cloud still work.
4. After configuring networking below, test a second account. It must get a different profile. A user without the toggle must receive 403 even when opening `/cloud-browser` directly.
5. Turn the permission off while that account is connected. The stream should stop. If the agent is temporarily unreachable, no new lease can be renewed and its idle cleanup stops the browser after roughly three minutes.

## Another device or another network

The HTTPS tunnel carries the client page and WebSocket signaling. **It does not relay the WebRTC UDP video/audio stream.** A public website address alone does not complete media networking.

For another device on your home Wi-Fi:

1. End sessions and stop the host with Ctrl+C.
2. Change `mediaAddress` in `host-config.json` from `127.0.0.1` to your PC's LAN IPv4 address, e.g. `192.168.1.50`. Prefer a DHCP reservation so it stays stable.
3. Allow the configured UDP ports through Windows Firewall, then restart `Start.ps1`. For the default one-session host, an Administrator PowerShell example is:

   ```powershell
   New-NetFirewallRule -DisplayName 'Novaris Browser media' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 57000 -Profile Private
   ```

For users on a different network, use your public IPv4 for `mediaAddress` and forward the configured UDP ports on your router to this PC, with the matching Windows Firewall rule. Default one session uses UDP **57000**; two sessions use **57000–57001**. Do not forward port 8092 or Docker's API. Some routers cannot loop back through their own public IP; use an outside-network test to check the public configuration.

If your ISP uses CGNAT, your public address changes, or the visitor's network blocks UDP, a TURN relay may be needed. Neko supports `iceServersFrontend` and `iceServersBackend` arrays in `host-config.json`, which are passed to its ICE configuration. This package does **not** provision a TURN server. Use properly scoped/rotated relay credentials and verify that configuration before offering remote access. TURN credentials sent to a client are visible to that client; never use the Novaris host key as a TURN credential.

## Capacity, privacy, and saved profiles

- Set `maxSessions` to `2` in the private config after the one-user test, then restart the host and permit the extra UDP port. Each container is limited to 3 GB RAM and 2 CPU cores; start with one or two on your 16 GB PC, especially while gaming. Supported configuration range is 1–4, not a promise your PC can run four smoothly.
- Each account has a distinct Docker volume named `novaris-neko-profile-<SHA256 of account ID>`. History, bookmarks and browser cookies stay in that volume. End session and idle cleanup remove the runtime container, not the profile. Docker reset/uninstall, deleting volumes, or `docker system prune --volumes` can erase them.
- Profiles are private from other Novaris users. The PC/Docker administrator can access their contents. Use trusted beta users; containers and Chromium policy are not a separate VM security boundary.
- Browser requests go through a mandatory public-address-only HTTP(S) proxy to block ordinary access to home-LAN services and metadata addresses. Downloads, file dialogs, developer tools and extensions remain restricted. This is a web browser, not a Windows application launcher.
- The host has no Supabase credentials. Novaris checks accounts and permission; the host trusts only its shared server key and server-selected user ID. Do not share or commit `host-config.json`.
- Closing the page stops lease renewals. The host sweeps idle sessions after three minutes. Admin revocation also requests an immediate container stop. Repeated website requests reuse the existing session for that account.
- A host restart cleans up only containers with its own `com.novaris.neko-host=v1` label. It retains profile volumes and does not touch the manual port-8090 test or Moonlight.

## Backups and updates

End all sessions, stop `Start.ps1` with Ctrl+C, and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Backup.ps1
```

This writes one compressed archive per profile in a dated folder under Documents. Store these privately: they include login cookies. Back up `host-config.json` separately in a secure location. For restore, keep the host stopped, recreate a volume with the exact archived name, and extract its archive into that volume using a temporary Docker container. Do not restore over an active browser. Retain the same Novaris/Supabase user IDs so profiles match their owners.

For an image update, stop the host, back up profiles, rerun Setup.ps1, and restart. Setup preserves the host key and settings but pins the newly built image ID. No website deployment is needed for host-only image updates. For startup at Windows login, enable Docker Desktop's sign-in startup and create a Task Scheduler task running PowerShell with `-NoProfile -ExecutionPolicy Bypass -File "FULL_PATH\Start.ps1"`, with a delay so Docker has time to start. Run it as your normal Docker-capable Windows user and keep the PC awake.

## Troubleshooting and verification scope

- **Host setup needed:** new website code/settings are not deployed, or the key/host URL is missing.
- **Could not start:** confirm Docker Desktop and Start.ps1 are running, the tunnel returns Unauthorized rather than 502, and both copies of the shared key match.
- **Page opens but video stays blank:** check `mediaAddress`, UDP ports, firewall/router or TURN. An HTTP health check cannot verify video transport.
- **All browsers in use:** end another session, wait for idle cleanup, or raise the limit after checking RAM.
- **Same-origin request error:** use the website address matching `CLOUD_BROWSER_PUBLIC_ORIGIN`.
- **Image build fails:** inspect the build error. Do not replace the pinned custom image with bare Neko; the custom image supplies persistence and browser restrictions.

Automated tests cover account gates, proxy behavior, WebSocket identity/revocation, Docker command/lifecycle behavior with a Docker test double, and egress DNS filtering. The local port-8090 Neko client was read to check its embedding/autologin support. The new image build, real multi-container WebRTC streams, and actual saved-cookie restart still require the local acceptance test above; Docker execution was unavailable to the coding environment.

Upstream references: [Neko Docker images](https://neko.m1k1o.net/docs/v3/installation/docker-images), [configuration](https://neko.m1k1o.net/docs/v3/configuration), [Chromium image source](https://github.com/m1k1o/neko/tree/master/apps/chromium), and [legacy client autologin](https://github.com/m1k1o/neko/blob/master/client/src/components/connect.vue).
