# Install Fuzz 6.2

Apply the patch from the project root:

```bash
unzip Fuzz-v6.2-Unified-Settings-Patch.zip
bash Fuzz-v6.2-Unified-Settings-Patch/apply-patch.sh .
```

Then run:

```bash
npm ci
npm run check
npm start
```

No new environment variables or Supabase migrations are required.

After deployment, hard-refresh the browser with `Ctrl + Shift + R`.
