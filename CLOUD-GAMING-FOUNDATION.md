# Novaris 8.2.0 — Cloud Gaming foundation

## Install

1. Run `supabase/NOVARIS_CLOUD_GAMING_SCHEMA.sql` in your existing Supabase project's SQL editor before deploying these files. The migration is repeatable. No accounts receive access automatically, including admins and owners.
2. Deploy the updated project, including the new `lib`, `views`, and SQL files. Keep your existing environment settings and use your normal dependency installation/start process. No new npm dependencies or environment variables are required.
3. Open Novaris Control → Users. Each user now has a Cloud Gaming ON/OFF switch. Turn it ON for authorized users. They see Cloud Gaming in the shared sidebar on their next page load and can visit `/cloud-games`.

The existing control panel remains owner-only, as in the supplied project. Its permission-management API accepts authenticated, unsuspended admins and owners. This change does not broaden the control panel's existing access policy.

If the migration has not been applied or the database is unavailable, Cloud Gaming is denied; its navigation is hidden. The user directory remains usable, but Cloud Gaming switches show Unavailable and an error toast. Reload the user directory after resolving the database issue.

## What changed

- Added an account-linked permission in `public.cloud_gaming_permissions`. Missing rows mean OFF. It uses RLS and revokes all browser-role privileges, avoiding self-grants through existing profile update policies. The existing backend service-role client is the only access path.
- Added an accessible ON/OFF switch in the existing user directory, with pending state, error handling, and activity logging. The server validates an actual boolean, user ID, and target account.
- Added protected `/cloud-games` and `/cloud-games.html` routes. Both require existing authentication, suspension checks, and a fresh permission lookup. Admins/owners have no implicit Cloud Gaming bypass. Permission errors fail closed. Page and API responses are not cached.
- Kept the HTML outside the public static tree to prevent static-file aliases from bypassing authorization.
- Added a Cloud Gaming sidebar entry gated by the server's permission result. The new Roblox card uses the existing Novaris backdrop, shared navigation, theme, and motion scripts, and clearly says streaming is not available yet. Its title remains Home.
- Kept the existing `/cloud` remote-PC/noVNC integration separate and unchanged. No noVNC, remote-desktop iframe, Roblox launch, streaming infrastructure, or new network service is introduced by this feature.
- Existing Games, proxy engines, fullscreen code, loaders, account flows, and role rules are unchanged. The application version remains 8.2.0.

## Future session-service boundary

`lib/cloud-gaming.js` exports a store and route registration function. Its optional `sessions` adapter has `create({ userId, gameId })`; the user ID is always taken from verified server authentication, never the request body. The default adapter returns no session.

`GET /api/cloud-games` returns the catalog with Roblox marked `coming_soon` and `launchable: false`. `POST /api/cloud-games/sessions` with `{ "gameId": "roblox" }` is permission-gated and returns HTTP 503 with `STREAMING_NOT_CONFIGURED`. Unknown games return 400 after authorization. No sessions are provisioned.

When implementing streaming later, update catalog availability and connect a trusted service adapter. Define session ownership, signaling authorization, quotas, expiration, and termination on permission revocation/ban/suspension. Keep every signaling, session-status, and stop route behind both account authentication and Cloud Gaming permission checks. Do not treat this foundation as a streaming-ready backend.

Permission administration:

- `GET /api/admin/cloud-gaming/permissions` — admins/owners only, paginated database lookup.
- `PATCH /api/admin/users/:userId/cloud-gaming` with `{ "enabled": true }` or `{ "enabled": false }` — admins/owners only.

## Validation

- Original `npm run check`: PASS (59 JavaScript files, 20 HTML files, 169 local asset references).
- Updated `npm run check`: PASS (61 JavaScript files, 21 HTML files, 181 local asset references).
- `npm run test:cloud-gaming`: PASS, 3 test groups. Uses real Express HTTP requests and the existing production authentication/role middleware with a mocked external identity lookup and in-memory permission store. Covers missing/false grants, all roles, admin-only mutations, invalid inputs, absent targets, audit logging, suspension/ban denial, database failures, revocation, GET/HEAD and alias protection, default-disabled sessions, and fail-closed navigation.
- `npm run lint`: FAIL, 34 errors and 214 warnings; the untouched original has the same totals.
- `npm run precommit`: audit PASS, Biome check FAIL, 121 errors and 214 warnings; the original Biome check has the same totals.
- Scoped `biome check` on the new backend module, test script, and CSS: PASS.
- Live Supabase migration execution, real-account end-to-end tests, and visual browser QA were not performed. The archive contains no deployment credentials. Existing lint/format issues were left untouched.

## Exact file list

Modified existing files:

1. `index.js` — register isolated Cloud Gaming routes; expose fail-closed navigation permission; add application paths.
2. `package.json` — add `test:cloud-gaming` script only.
3. `scripts/audit-project.mjs` — require the new core files in the project audit.
4. `static/assets/js/admin/api.js` — permission read/update client calls.
5. `static/assets/js/admin/users.js` — load permission state and render/manage each user's toggle.
6. `static/assets/js/m1.js` — permission-aware Cloud Gaming navigation.

Added files:

7. `lib/cloud-gaming.js` — permission persistence, authorization, administration, catalog, and session-service boundary.
8. `supabase/NOVARIS_CLOUD_GAMING_SCHEMA.sql` — account-linked, server-only permission table.
9. `views/cloud-games.html` — protected Cloud Games page with Roblox placeholder.
10. `static/assets/css/cloud-games.css` — responsive card styling using the existing theme.
11. `scripts/test-cloud-gaming.mjs` — authorization and regression tests.
12. `docs/CLOUD-GAMING-FOUNDATION.md` — this setup, design, validation, and file report.

No files were deleted. `package-lock.json` is unchanged.
