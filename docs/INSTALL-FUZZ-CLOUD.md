# Fuzz Cloud

Fuzz Cloud is the private remote-PC launcher built around Apache Guacamole.

## Current design

- `/cloud` is a protected Fuzz page.
- Configure it under **Admin -> Settings -> Fuzz Cloud**.
- `/api/cloud/config` returns the active server-side configuration.
- The frontend uses the returned `launchUrl`; the gateway is not hardcoded in the browser bundle.
- Launch Desktop opens Guacamole through the selected Fuzz proxy engine.
- Open gateway directly remains available as a troubleshooting fallback.
- Guacamole authentication is still required unless you later add a supported SSO design.

## Optional environment defaults

```env
FUZZ_CLOUD_NAME=Gaming PC
FUZZ_CLOUD_BASE_URL=https://guac.example.com
```

The Cloud URL must use HTTPS.

## Existing SQL

The repository contains:
- `supabase/FUZZ_CLOUD_SCHEMA.sql`
- `supabase/FUZZ_CLOUD_GUAC_ONLY_MIGRATION.sql`

Run only the migrations your current database still needs.

## Security

Keep the Guacamole gateway password protected. Owner-only access in Fuzz does not replace Guacamole authentication. Do not expose Windows RDP port 3389 directly to the public internet.
