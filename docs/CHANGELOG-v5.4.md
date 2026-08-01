# FuzzTheHuzz v5.4 Stability Changelog

## Authentication

- Replaced browser-side Supabase login with `POST /api/auth/login`.
- Added `GET /api/auth/status` for safe session checks.
- Kept access and refresh tokens in HTTP-only, secure, SameSite cookies.
- Added basic per-IP and per-email login throttling.
- Added explicit errors for missing profiles, banned accounts, and suspensions.
- Protected all private `.html` files, not only the short routes.
- Added `account.html` and other direct file addresses to protected access.

## Fuzz AI

- Restored the correct Fuzz AI client after `ai.js` had been overwritten by unrelated admin code.
- Connected chat creation to the first user message.
- Saves both user and assistant messages.
- Loads saved conversations when `/ai` opens.
- Restores a conversation after refresh.
- Added saved-chat rename and delete controls.
- Clears the active chat identifier when **New Chat** is pressed.
- Surfaces database save errors instead of silently discarding chats.
- Keeps AI generation usable when a save attempt fails.
- Added a clear `OPENAI_API_KEY` setup response instead of crashing the entire server.

## Database

- Added `supabase/FUZZ_STABILITY_SCHEMA.sql`.
- Creates or upgrades all tables referenced by the backend.
- Adds the missing `fuzz_consume_usage` RPC.
- Backfills missing profiles for existing Supabase Auth users.
- Adds indexes used by chat, activity, security, bookmarks, and admin queries.
- Enables RLS and keeps data access on the server service role.
- Seeds platform settings and unlimited-by-default role usage policies.

## Privacy and security

- Removed the root-level remote advertising service worker.
- Removed ad and analytics scripts from legacy pages.
- Replaced the old Games page with a clean redirect to Apps.
- Removed obsolete pre-overhaul Tabs copies.
- Removed the hardcoded browser-delivered Supabase key.
- Removed Express's `X-Powered-By` response header.
- Corrected CSP sources required by the AI rendering libraries.
- Preserves local Fuzz preferences during logout instead of clearing all browser storage.

## Interface and reliability

- Kept the redesigned Apps interface unchanged.
- Kept the classic Home layout with upgraded search, proxy selector, quick links, bookmarks, and recents.
- Disabled the unwanted onboarding launch while retaining compatibility methods.
- Replaced **Restart onboarding** with **Reset interface defaults**.
- Added safer cache headers for HTML, JavaScript, CSS, service workers, and proxy assets.
- Added health output showing Supabase and OpenAI configuration status.

## Deployment and maintenance

- Updated the release to `5.4.0`.
- Added a production Cloud Run Dockerfile using `npm ci` and a non-root user.
- Added `.dockerignore` and `.env.example`.
- Removed unsupported Vercel/Render/Heroku leftovers, unused masking code, default legacy credentials, and the duplicate pnpm lockfile.
- Removed the unused `express-basic-auth` dependency.
- Added `npm run check` and `scripts/audit-project.mjs`.
- The audit checks JavaScript syntax, duplicate HTML IDs, missing local assets, required DOM hooks, removed ad domains, and browser-exposed JWT-like secrets.
