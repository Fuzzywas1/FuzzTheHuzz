# Novaris Browser Host

Start with the included `CLOUD-BROWSER-WINDOWS.md` in the standalone ZIP, or `../../docs/CLOUD-BROWSER-WINDOWS.md` in the full project.

This folder runs on your **Windows PC**, not in Cloud Shell or Codespaces. Start Docker Desktop, open PowerShell here, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Setup.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\Start.ps1
```

Default first test: one user, from this PC only. The generated `host-config.json` contains a private shared key. Keep it out of uploads and source control.

`configure-cloud-run.sh` is the exception: run it in **Google Cloud Shell** after deploying the website patch and configuring the tunnel route.
