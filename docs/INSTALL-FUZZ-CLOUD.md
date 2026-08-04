# Fuzz Cloud v1

This update adds a private Fuzz Cloud launcher without redesigning or replacing any existing page.

## Included

- `/cloud` page styled to match the existing Fuzz sidebar and space theme.
- Direct MeshCentral desktop launch (`viewmode=11`) with all UI regions hidden (`hide=63`).
- Owner-only access by default.
- Fuzz Control settings for enabling Cloud, changing the computer name, server URL, node ID, access mode, and desktop-only mode.
- Server-side launch URL generation so the node ID is not hardcoded into the static Cloud page.

## One-time Supabase step

Before changing Cloud settings in Fuzz Control, run:

`supabase/FUZZ_CLOUD_SCHEMA.sql`

in the Supabase SQL Editor. The Cloud page already has the supplied permanent domain and node ID as server defaults, so it can launch immediately after deployment; the SQL update makes admin changes persistent.

## Permanent MeshCentral address

`https://cloud.fuzzthehuzz-ebsfiygfhsvfbfesg.com`

## Access

Fuzz Cloud is enabled and owner-only by default. Change this from **Admin → Settings → Fuzz Cloud**.
