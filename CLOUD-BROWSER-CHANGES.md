# Cloud Browser change report

Relative to the previously delivered Novaris-8.2.0-Cloud-Gaming-Foundation.zip.

Validation: 5/5 Cloud Browser tests passed; project audit passed (64 JavaScript files, 21 HTML files, 182 asset references). Scoped checks for the six new code/style files passed. Full lint remains at the baseline 34 errors and 214 warnings; precommit remains at the baseline 121 errors and 214 warnings. No live Docker, Supabase or HTTPS deployment was tested.

## Modified

- `.env.example`
- `index.js`
- `package.json`
- `scripts/audit-project.mjs`
- `static/assets/js/admin/api.js`
- `static/assets/js/admin/users.js`
- `static/assets/js/m1.js`

## Added

- `deploy/cloud-browser/Caddyfile.example`
- `deploy/cloud-browser/novaris-browser-network.service`
- `deploy/cloud-browser/setup-network.sh`
- `docs/CLOUD-BROWSER.md`
- `lib/cloud-browser-host.js`
- `lib/cloud-browser-store.js`
- `lib/cloud-browser.js`
- `scripts/test-cloud-browser.mjs`
- `static/assets/css/cloud-browser.css`
- `static/assets/js/cloud-browser.js`
- `supabase/NOVARIS_CLOUD_BROWSER_SCHEMA.sql`
- `views/cloud-browser.html`

## Removed

- `docs/CLOUD-GAMING-FOUNDATION.md`
- `lib/cloud-gaming.js`
- `scripts/test-cloud-gaming.mjs`
- `static/assets/css/cloud-games.css`
- `views/cloud-games.html`

