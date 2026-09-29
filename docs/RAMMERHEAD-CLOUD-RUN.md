# Rammerhead on Google Cloud Run

Prepared for project `fuzzthehuzz-499122`, region `us-south1`, existing service `novaris`.
This ZIP contains the full Novaris project plus a separate Rammerhead backend build.
No deployment has been performed by the assistant. No layout, HTML, CSS, Games,
Scramjet, Ultraviolet, Supabase schema, or account permissions were changed in this update.

## Install in Google Cloud Shell

1. Download `Novaris-8.2.0-Rammerhead-CloudRun.zip` to your computer.
2. Open https://console.cloud.google.com/?project=fuzzthehuzz-499122 and activate Cloud Shell using the terminal icon near the top.
3. In Cloud Shell, choose the three-dot menu > Upload > upload the ZIP. Keep its filename unchanged.
4. Paste this block into Cloud Shell. It extracts to a new directory without replacing your existing source:

```bash
cd ~
NOVARIS_SETUP_DIR="$(mktemp -d "$HOME/novaris-rh-setup.XXXXXX")"
unzip -q "$HOME/Novaris-8.2.0-Rammerhead-CloudRun.zip" -d "$NOVARIS_SETUP_DIR"
cd "$NOVARIS_SETUP_DIR/FuzzTheHuzz-Beta"
bash deploy/rammerhead-cloudrun/deploy.sh
```

Run this using the Google account that manages the existing project. The script
needs permission to enable APIs, create a service account and a secret, grant
access to that secret, build images and deploy Cloud Run services. Organization
policies may prevent a public Cloud Run service. If any command fails, stop and
share the error text with secrets removed. Do not paste keys or Supabase values.
Cloud Build's service account may need the usual build/Artifact Registry permissions
if this project has restricted its default build identity; the script does not grant
project-wide roles automatically.

The script:

- Checks that the existing Novaris service and its service account are present.
- Prints the current ready revision for rollback. Save that line.
- Creates `novaris-rammerhead`, a dedicated runtime service account, and the
  `novaris-rammerhead-key` Secret Manager secret. Both services get access only to
  this secret through secret-level grants. It does not grant project-wide roles to
  the new account.
- Builds the pinned upstream backend, runs its tests, deploys it, discovers its
  actual URL, and checks authentication and real page rewriting.
- Builds and deploys this Novaris source to the existing `novaris` service, changing
  only the Rammerhead environment/secret configuration. Existing environment and
  Supabase secret settings are preserved. The deployed application source is replaced
  by this ZIP; do not use it if you made newer source changes after the last ZIP.

## Try it

Open https://novaris-905797448932.us-south1.run.app, sign in, select **Rammerhead**
where you select a proxy engine, and navigate to `https://example.com` first.
Rammerhead is an alternative proxy engine, not the Cloud Browser streaming tab.
The existing signed-in account and global proxy access checks still apply.
If it fails, select Scramjet or Ultraviolet while troubleshooting.

## Costs and limits

The backend uses 1 vCPU, 1 GiB memory, request-based billing, minimum 0 instances,
and a configured maximum of 1 instance. The maximum is a scaling control, not a
hard bill cap or a guarantee that revisions never overlap during deployment.
Requests, open WebSockets, outbound bandwidth, builds, image storage, logs and
Secret Manager can create charges. Set a budget alert in Google Cloud Billing;
an alert does not stop spending. No fixed monthly price or free operation is promised.

The single-port mode is an upstream compatibility compromise: cross-origin behavior
can break on some sites. HTTP/2 to destinations is disabled for this first setup.
This is a small personal test deployment, not a persistent cloud browser profile service.
Session cookies/local storage can disappear when the backend restarts, scales to zero,
or redeploys; Novaris also keeps its session mapping in memory. Relaunch through Novaris
to create a new session. Do not increase the backend instance limit without adding a
shared session store and coordinating Novaris's session mappings. Affinity alone is
not a persistence guarantee. A WebSocket can close when the request timeout expires.

## Security and maintenance

Cloud Run ingress is public because users' browsers load the proxy directly. Creating,
editing, checking and deleting sessions requires a server-side header secret. There is
no public upstream session-creation UI. Session URLs are bearer capabilities: anyone
who obtains a URL can use that session. Do not share them. Cloud Run request logs can
contain session IDs and destination URLs; limit who can view logs. Management passwords
are absent from network URLs and upstream traffic logs are silenced.

The backend blocks outbound private, loopback, link-local, metadata and other special
IP destinations, including DNS results and mapped IPv6. It strips metadata headers,
does not attach a VPC, runs as the non-root `node` user, and uses a dedicated service
account. This is defense in depth, not a security certification of upstream Rammerhead.

Upstream is pinned to `ee5fbb7837f5fe752c4b82c18184f42449678d5b`. Runtime clustering
dependencies are omitted because only one process is used; UUID is updated and
Underscore is overridden to a patched release. The backend lockfile audit reported
zero known vulnerabilities when prepared. Rebuild/re-audit periodically; the pinned
dependency result does not cover the operating-system image or future advisories.

## Roll back or stop

The setup script prints an exact rollback command for the previous Novaris revision.
Use that command to restore traffic if needed. It does not delete the new backend.
To stop and delete the Rammerhead service:

```bash
gcloud run services delete novaris-rammerhead --project=fuzzthehuzz-499122 --region=us-south1
```

Image storage in the `novaris-proxies` Artifact Registry repository, the dedicated
secret and logs can remain billable after service deletion. Remove only those
Rammerhead resources when finished; do not delete Novaris or its Supabase secrets.
Cloud Run's ephemeral files are not backed up. This ZIP is your source backup;
Supabase account data stays in your existing Supabase project.

## Validation performed locally

- 10 Novaris feature tests passed; 4 backend guard tests passed.
- Real built backend: session lifecycle, header authentication, HTTPS page rewriting,
  injected client scripts, metadata blocking and no management-secret logs passed.
- Project audit: 66 JavaScript files, 21 HTML files, 182 local asset references passed.
- Bash syntax check passed. Existing lint: 34 errors/214 warnings; existing full
  Biome check: 122 errors/214 warnings, unchanged from the base ZIP.
- Docker engine access was unavailable, so a full container build was not verified
  locally. Google Cloud deployment, Google IAM permissions and browser compatibility
  on the deployed site remain unverified. The script runs tests during the cloud build
  and checks the live backend before replacing Novaris's revision.

References: https://docs.cloud.google.com/run/docs/container-contract,
https://docs.cloud.google.com/run/docs/triggering/websockets,
https://docs.cloud.google.com/run/docs/configuring/services/secrets,
https://cloud.google.com/run/pricing.
