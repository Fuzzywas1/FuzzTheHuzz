# Validation Report

## Automated checks completed

- `node --check index.js`
- JavaScript syntax checks across application source files
- Duplicate HTML ID scan
- Local HTML asset-reference scan
- Required page DOM-hook checks
- Required backend route-marker checks
- Ad/tracker-domain scan
- Browser-source JWT-like secret scan
- ZIP integrity verification

## Environment limitation

The audit environment could not connect to the user's Supabase project, OpenAI account, or live Cloud Run service. Live authentication, database writes, AI streaming, WebSocket proxy traffic, and Cloudflare-protected destination sites must be tested after deployment with the user's own environment variables.

## Required live tests

1. Sign in and sign out.
2. Refresh a protected page and confirm the session persists.
3. Send an AI message, refresh `/ai`, and reopen the saved chat.
4. Rename and delete a saved AI chat.
5. Load Apps and save a favorite.
6. Save and remove a bookmark.
7. Open a Scramjet tab and an Ultraviolet fallback tab.
8. Open Account and Status.
9. Open Admin as an owner and verify users, announcements, usage settings, and health.
10. Confirm a signed-out visitor cannot open `/account.html`, `/ai.html`, or `/admin.html` directly.
