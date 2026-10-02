> **Windows PC + Cloud Run:** use [CLOUD-BROWSER-WINDOWS.md](CLOUD-BROWSER-WINDOWS.md). The instructions below describe the older single Linux host deployment.

# Novaris Cloud Browser

This replaces the Cloud Gaming placeholder with admin-controlled Chromium sessions. Each account has a persistent Docker profile volume. It uses LinuxServer Selkies WebSocket/WebCodecs streaming, not WebRTC or noVNC. The existing /cloud feature is unchanged.

## Deployment status

Prepared single-host integration; not deployed. Tests cover local HTTP/WebSocket fixtures and mocked Docker commands. Actual Linux containers, HTTPS streaming, firewall isolation, Supabase and persistent browser profiles still require host acceptance testing.

## Setup

1. Use a dedicated Linux host with Docker's iptables backend, Node 20+ and npm 10+, a domain and HTTPS. Run exactly one Novaris Node process on the Docker host. Multiple replicas, cluster mode and the original application Dockerfile are unsupported by this adapter.
2. Extract the project and preserve your existing production .env. Install dependencies with npm ci. Restore SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) if startup reports missing credentials. Never expose the server key in frontend code.
3. Run supabase/NOVARIS_CLOUD_BROWSER_SCHEMA.sql in Supabase SQL Editor. It reuses cloud_gaming_permissions so previous grants survive. Missing grants deny access; only the server accesses this table.
4. Install Docker and permit only trusted operators and the Novaris service account to use it. Docker access is privileged. Install the supplied network rules before enabling browser sessions:

```bash
sudo install -m 0755 deploy/cloud-browser/setup-network.sh /usr/local/sbin/novaris-browser-network
sudo install -m 0644 deploy/cloud-browser/novaris-browser-network.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now novaris-browser-network.service
```

The script reserves subnet 172.30.88.0/24, bridge novaris-br and network novaris-browsers. Check for network conflicts first. It blocks browser-initiated connections to the host, peers, LAN and common metadata ranges. Keep these rules active whenever containers run. NETWORK_READY is operator acknowledgement, not automatic firewall verification.

5. Pull and inspect the image:

```bash
docker pull lscr.io/linuxserver/chromium:latest
docker image inspect lscr.io/linuxserver/chromium:latest --format '{{index .RepoDigests 0}}'
```

Review and test the image version. Copy the returned immutable lscr.io/linuxserver/chromium@sha256:... reference into CLOUD_BROWSER_IMAGE. The server requires a digest and never pulls images during requests. Test again before changing that digest.

6. Add to the server .env:

```dotenv
CLOUD_BROWSER_ENABLED=true
CLOUD_BROWSER_PUBLIC_ORIGIN=https://YOUR_NOVARIS_HOSTNAME
CLOUD_BROWSER_IMAGE=lscr.io/linuxserver/chromium@sha256:YOUR_VERIFIED_DIGEST
CLOUD_BROWSER_NETWORK_READY=true
CLOUD_BROWSER_MAX_SESSIONS=2
CLOUD_BROWSER_IDLE_SECONDS=180
```

7. Run npm start under a process manager. For a systemd novaris.service, add Requires=novaris-browser-network.service and After=novaris-browser-network.service in its Unit section. Configure the service account and working directory. Put an HTTPS reverse proxy in front of Node; deploy/cloud-browser/Caddyfile.example is a starting point. Match its port to your Node configuration. Keep Node, Docker and individual browser ports private; only HTTPS should be public. WebSocket upgrades must work.
8. Enable Cloud Browser for an account in the existing Control Panel and visit /cloud-browser. The panel retains its existing role restrictions; permission changes require admin/owner authorization.

## Acceptance checks before public use

Test navigation, input, audio and fullscreen on the real host. End and reopen a session to verify saved logins/history. Test a second account for profile separation, denied accounts, direct stream URLs, permission revocation, logout/session expiry, idle cleanup, container crashes and host reboot. Verify private-network and metadata endpoints cannot be reached from the browser. Do not grant broad access until these checks pass.

## Lifecycle and limits

Each runtime has a random session ID, private loopback port and internal credential. The gateway checks authentication, permission and ownership, and removes Novaris identity headers before proxying. Active WebSocket authorization is rechecked periodically; revocation can take up to 15 seconds. Session expiry may require reopening the page.

Containers are limited to 2 GiB memory, one CPU quota and 1 GiB shared memory within that memory limit. Default capacity is two sessions. Leave host resources for Novaris and the OS. This adapter has no queue, autoscaling or multi-host scheduling.

Ending a session or idle cleanup removes the runtime while retaining its /config volume. Closing the page stops heartbeats; cleanup occurs after the idle interval plus the sweep delay. After a process restart, the next launch removes orphan runtimes carrying the Novaris label, retaining volumes. Crashes can lose recently unsaved browser state.

Profiles are keyed by SHA-256 of the Supabase user UUID. Host administrators can access them; private per-user profiles do not mean encryption against server operators. Back up volumes securely. Deleting an account does not automatically delete its Docker volume. Operators must manage retention; never remove a volume while its browser is running.

## Validation

Run npm run test:cloud-browser, npm run check, npm run lint and npm run precommit. The delivered change report records results and exact changed files. Existing unrelated lint/format errors have not been rewritten.

## Upstream references

- https://docs.linuxserver.io/images/docker-chromium/
- https://docs.linuxserver.io/selkies/user-guide/configuration/
- https://docs.linuxserver.io/selkies/user-guide/security/
- https://docs.linuxserver.io/selkies/user-guide/reverse-proxy/
