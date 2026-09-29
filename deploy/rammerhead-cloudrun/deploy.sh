#!/usr/bin/env bash
# Run in Google Cloud Shell, from this ZIP. Creates billable resources.
set -euo pipefail
set +x
PROJECT=fuzzthehuzz-499122
REGION=us-south1
SERVICE=novaris-rammerhead
SECRET=novaris-rammerhead-key
ACCOUNT=novaris-rammerhead
SA="$ACCOUNT@$PROJECT.iam.gserviceaccount.com"
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$HERE/../.." && pwd)"
GCLOUD=(gcloud --project="$PROJECT" --quiet)

# Verify the existing service first; do not accidentally create a second Novaris.
PREVIOUS="$("${GCLOUD[@]}" run services describe novaris --region="$REGION" --format='value(status.latestReadyRevisionName)')"
NOVARIS_SA="$("${GCLOUD[@]}" run services describe novaris --region="$REGION" --format='value(spec.template.spec.serviceAccountName)')"
if [[ -z "$PREVIOUS" || -z "$NOVARIS_SA" ]]; then
  echo 'Could not determine the existing Novaris revision/service account. Nothing deployed.' >&2
  exit 1
fi
printf 'Existing Novaris revision (save for rollback): %s\n' "$PREVIOUS"
"${GCLOUD[@]}" services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com iam.googleapis.com
if ! "${GCLOUD[@]}" iam service-accounts describe "$SA" >/dev/null 2>&1; then
  "${GCLOUD[@]}" iam service-accounts create "$ACCOUNT" --display-name='Novaris Rammerhead only'
fi
if ! "${GCLOUD[@]}" secrets describe "$SECRET" >/dev/null 2>&1; then
  openssl rand -hex 32 | tr -d '\n' | "${GCLOUD[@]}" secrets create "$SECRET" --replication-policy=automatic --data-file=-
fi
VERSION="$("${GCLOUD[@]}" secrets versions list "$SECRET" --filter='state=ENABLED' --sort-by='~createTime' --limit=1 --format='value(name)')"
VERSION="${VERSION##*/}"
[[ "$VERSION" =~ ^[0-9]+$ ]] || { echo 'No enabled secret version.' >&2; exit 1; }
for identity in "$SA" "$NOVARIS_SA"; do
  "${GCLOUD[@]}" secrets add-iam-policy-binding "$SECRET" --member="serviceAccount:$identity" --role=roles/secretmanager.secretAccessor >/dev/null
done
if ! "${GCLOUD[@]}" artifacts repositories describe novaris-proxies --location="$REGION" >/dev/null 2>&1; then
  "${GCLOUD[@]}" artifacts repositories create novaris-proxies --repository-format=docker --location="$REGION"
fi
IMAGE="$REGION-docker.pkg.dev/$PROJECT/novaris-proxies/rammerhead:$(date -u +%Y%m%d%H%M%S)"
"${GCLOUD[@]}" builds submit "$HERE" --tag="$IMAGE"
"${GCLOUD[@]}" run deploy "$SERVICE" --image="$IMAGE" --region="$REGION" \
  --service-account="$SA" --allow-unauthenticated --port=8080 --cpu=1 --memory=1Gi \
  --min=0 --max=1 --max-instances=1 --concurrency=40 --timeout=3600 \
  --cpu-throttling --no-cpu-boost --session-affinity --clear-vpc-connector --clear-network \
  --update-secrets="RAMMERHEAD_PASSWORD=$SECRET:$VERSION"
URL="$("${GCLOUD[@]}" run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')"
[[ "$URL" =~ ^https://[a-z0-9.-]+\.run\.app$ ]] || { echo 'Unexpected service URL' >&2; exit 1; }
"${GCLOUD[@]}" run services update "$SERVICE" --region="$REGION" --update-env-vars="RH_PUBLIC_ORIGIN=$URL"
curl --fail --silent --show-error --retry 5 "$URL/healthz"
if [[ "$(curl --silent --output /dev/null --write-out '%{http_code}' "$URL/newsession")" != 403 ]]; then
  echo 'Management authentication check failed; Novaris was not changed.' >&2
  exit 1
fi
# Verify header auth and a real rewritten page before updating Novaris.
"${GCLOUD[@]}" secrets versions access "$VERSION" --secret="$SECRET" | python3 "$HERE/verify-backend.py" "$URL"
# Deploy the updated adapter and preserve all existing Supabase/env/secret settings.
"${GCLOUD[@]}" run deploy novaris --source="$ROOT" --region="$REGION" \
  --update-env-vars="RAMMERHEAD_API_URL=$URL,RAMMERHEAD_PUBLIC_URL=$URL,RAMMERHEAD_AUTH_MODE=header" \
  --update-secrets="RAMMERHEAD_PASSWORD=$SECRET:$VERSION"
printf '\nRammerhead deployed: %s\nOpen Novaris, choose Rammerhead, and try https://example.com\n' "$URL"
printf 'Rollback Novaris: gcloud run services update-traffic novaris --project=%s --region=%s --to-revisions=%s=100\n' "$PROJECT" "$REGION" "$PREVIOUS"
