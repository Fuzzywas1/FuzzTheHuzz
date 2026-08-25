# Fuzz Cloud — noVNC

Fuzz Cloud now uses **noVNC + websockify** instead of Apache Guacamole.

## Connection path

```text
Fuzz Cloud
  -> HTTPS Cloudflare Tunnel
  -> noVNC / websockify
  -> TightVNC on the Windows PC
```

The public Cloudflare hostname should point to the local noVNC/websockify HTTP port. Do **not** expose TightVNC port 5900 directly to the internet.

## Default Fuzz configuration

```env
FUZZ_CLOUD_NAME=Gaming PC
FUZZ_CLOUD_BASE_URL=https://vnc.fuzzthehuzz-ebsfiygfhsvfbfesg.com
```

The Cloud page automatically builds:

```text
/vnc.html?autoconnect=true&resize=scale
```

The VNC password is entered in noVNC and is not stored by Fuzz.

## Admin settings

Open **Admin -> Settings -> Fuzz Cloud**. The noVNC gateway must be an HTTPS URL.

- **Owner only** keeps Fuzz Cloud hidden/blocked for non-owner accounts.
- **Integrated workspace** embeds noVNC inside the Fuzz Cloud page.
- Turning integrated workspace off opens noVNC in its own browser tab.

## Windows-side services

The Windows PC should have these running automatically:

- TightVNC Server
- Docker Desktop / the `fuzz-novnc` container
- Cloudflare Tunnel (`cloudflared`)

TightVNC must allow the local/loopback connection used by websockify.

## Removing old Guacamole

Only remove the old Guacamole containers after noVNC has been tested remotely. The Fuzz website no longer depends on Guacamole, `guacd`, or the Guacamole PostgreSQL container.
