# Install Fuzz 6.1

## Patch install

Place the extracted patch folder in the root of the existing Fuzz project and run:

```bash
bash Fuzz-v6.1-Sidebar-AI-Refresh-Patch/apply-patch.sh .
```

The installer creates a timestamped backup of every replaced file.

Then run:

```bash
npm ci
npm run check
npm start
```

Hard-refresh the browser after deployment:

```text
Ctrl + Shift + R
```

## Full-project install

Extract the full-project ZIP, preserve your private `.env`, and deploy the extracted project normally.

No database migration is required for 6.1. The existing Fuzz 6.0 Supabase schemas must already be installed for saved AI chats, community chat, feedback, and personalization.
