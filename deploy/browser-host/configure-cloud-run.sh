#!/usr/bin/env bash
set -euo pipefail
PROJECT=fuzzthehuzz-499122
REGION=us-south1
SERVICE=novaris
SECRET=novaris-browser-host-key
read -r -p 'Browser host HTTPS address (example https://browser-host.your-domain.com): ' HOST_URL
if [[ ! "$HOST_URL" =~ ^https://[a-zA-Z0-9.-]+/?$ ]]; then echo 'Enter an HTTPS hostname with no path.' >&2; exit 1; fi
read -r -p 'Novaris website address [https://novaris-905797448932.us-south1.run.app]: ' PUBLIC_ORIGIN
PUBLIC_ORIGIN=${PUBLIC_ORIGIN:-https://novaris-905797448932.us-south1.run.app}
if [[ ! "$PUBLIC_ORIGIN" =~ ^https://[a-zA-Z0-9.-]+/?$ ]]; then echo 'Enter an HTTPS hostname with no path.' >&2; exit 1; fi
read -r -s -p 'Paste key from the Windows host-config.json (hidden): ' HOST_KEY
echo
if [[ ${#HOST_KEY} -lt 32 ]]; then echo 'Host key is too short.' >&2; exit 1; fi
umask 077
KEY_FILE=$(mktemp)
trap 'rm -f "$KEY_FILE"; unset HOST_KEY' EXIT
printf '%s' "$HOST_KEY" > "$KEY_FILE"
unset HOST_KEY
gcloud services enable secretmanager.googleapis.com --project="$PROJECT"
if ! gcloud secrets describe "$SECRET" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud secrets create "$SECRET" --replication-policy=automatic --project="$PROJECT"
fi
VERSION=$(gcloud secrets versions add "$SECRET" --data-file="$KEY_FILE" --project="$PROJECT" --format='value(name)')
VERSION=${VERSION##*/}
ACCOUNT=$(gcloud run services describe "$SERVICE" --region="$REGION" --project="$PROJECT" --format='value(spec.template.spec.serviceAccountName)')
if [[ -z "$ACCOUNT" ]]; then
  NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
  ACCOUNT="${NUMBER}-compute@developer.gserviceaccount.com"
fi
gcloud secrets add-iam-policy-binding "$SECRET" --member="serviceAccount:$ACCOUNT" --role=roles/secretmanager.secretAccessor --project="$PROJECT" >/dev/null
# Update only these settings; preserve Supabase, Rammerhead and all other environment variables.
gcloud run services update "$SERVICE" --region="$REGION" --project="$PROJECT" \
  --update-env-vars="CLOUD_BROWSER_ENABLED=true,CLOUD_BROWSER_HOST_URL=${HOST_URL%/},CLOUD_BROWSER_PUBLIC_ORIGIN=${PUBLIC_ORIGIN%/}" \
  --update-secrets="CLOUD_BROWSER_HOST_KEY=${SECRET}:${VERSION}" --timeout=3600
echo 'Configuration saved. The Novaris website must also have the updated project code deployed.'
