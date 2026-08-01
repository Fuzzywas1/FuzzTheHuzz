# Install FuzzTheHuzz v6.0

Fuzz 6.0 is a large application and database update. Back up the project and Supabase database before replacing files.

## Environment variables

Keep the existing `.env` file for local development or the existing Cloud Run environment variables. This update does not require a new secret.

Required values:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SECRET_KEY=YOUR_SUPABASE_SECRET_KEY
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
OPENAI_MODEL=gpt-5-mini
PORT=8080
```

`SUPABASE_SERVICE_ROLE_KEY` remains supported as the legacy alternative to `SUPABASE_SECRET_KEY`.

Never commit `.env` to GitHub.

## Required Supabase migrations

Run these files in **Supabase → SQL Editor** in this order:

1. `supabase/FUZZ_STABILITY_SCHEMA.sql`
2. `supabase/FUZZ_6_COMMUNITY_SCHEMA.sql`

The second migration creates the Chat, personalization, feedback, notification, and private Storage resources. It is designed to be safe to run more than once.

After running both migrations, open:

```text
/api/setup-test
```

A complete setup reports:

```json
{
  "connected": true,
  "communityReady": true
}
```

## Install the complete project

Preserve `.env`, replace the project files, and run:

```bash
npm ci
npm run check
npm start
```

## Apply the patch ZIP

Place the patch ZIP in the root of the existing v5.4 project, then run:

```bash
unzip Fuzz-v6.0-Community-Customization-Mega-Patch.zip
bash Fuzz-v6.0-Community-Customization-Mega-Patch/apply-patch.sh .
```

The installer:

- copies all added and changed v6.0 files;
- preserves `.env`;
- creates `.env.before-v6.0-backup` when `.env` exists;
- does not install dependencies or run database migrations automatically.

Then run:

```bash
npm ci
npm run check
npm start
```

## Cloud Run deployment

Continue using the included `Dockerfile`. In Cloud Run, verify the Supabase and OpenAI variables under **Edit and deploy new revision → Variables & Secrets**.

After deployment, test:

```text
/health
/api/setup-test
/login
/
/chat
/feedback
/c
/settings
/ai
/b
/d
/p
/account
/admin
/status
```

## First-use test

Use two separate Fuzz accounts in separate browser profiles:

1. Open Chat on both accounts.
2. Send messages in Everyone.
3. Start a DM from one account to the other.
4. Verify unread badges and the notification center.
5. Reply, react, edit, and delete a test message.
6. Block the other account, verify the DM stops working, then unblock it under Settings.
7. Upload a wallpaper and verify it follows the account after signing in elsewhere.
8. Submit feedback and use an admin or moderator account to reply and change its status.
9. Verify the user sees the new feedback notification.

## Cache refresh

After the first deployment, perform one hard refresh:

```text
Ctrl + Shift + R
```
