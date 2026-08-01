# FuzzTheHuzz v5.4 Stability Update

This release repairs authentication, Fuzz AI chat persistence, private-route protection, database setup, stale client caching, and deployment hygiene.

## Before replacing the project

1. Keep a private copy of your current `.env` values or your Cloud Run environment variables.
2. Do not upload `.env` to GitHub.
3. Back up your Supabase database before applying a large migration.

## Required Supabase step

Open your Supabase project, go to **SQL Editor**, create a new query, paste the entire contents of:

```text
supabase/FUZZ_STABILITY_SCHEMA.sql
```

Run it once. The migration is idempotent, so it can be run again if the first attempt is interrupted.

The migration:

- creates or upgrades every table used by Fuzz;
- restores missing profiles for existing Auth users;
- promotes the oldest profile only when the project has no owner at all;
- adds the `fuzz_consume_usage` RPC required by AI and proxy usage checks;
- enables row-level security with server-only service-role access;
- sets usage limits to unlimited by default (`0`) so the update does not unexpectedly block users.

## Cloud Run environment variables

Set these variables on the Cloud Run service:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SECRET_KEY
OPENAI_API_KEY
OPENAI_MODEL
```

`SUPABASE_SERVICE_ROLE_KEY` is also supported as the legacy alternative to `SUPABASE_SECRET_KEY`. `OPENAI_MODEL` is optional and defaults to `gpt-5-mini`.

Fuzz can start without `OPENAI_API_KEY`, but `/ai` will return a clear setup error until the key is added.

## Install the full project

Replace the project files while preserving your private environment configuration, then run:

```bash
npm ci
npm run check
npm start
```

## Deploy to Cloud Run

Use the included `Dockerfile`. It installs from `package-lock.json`, runs as the non-root `node` user, and listens on port `8080`.

After deployment, verify:

```text
/health
/login
/
/ai
/b
/d
/account
/admin
/status
```

## First login after migration

The login page now sends credentials to the Fuzz server. The server creates HTTP-only Supabase session cookies; no Supabase key is embedded in the login JavaScript.

If an existing Supabase Auth user did not have a `profiles` row, the migration creates one. When no owner exists at all, the oldest profile is promoted to owner.

## Cache refresh

The repaired login and AI scripts use new cache versions. After deployment, perform one hard refresh:

```text
Ctrl + Shift + R
```
