#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="us-south1-docker.pkg.dev/fuzzthehuzz-499122/novaris-proxies/rammerhead:iframe-fix-$(date -u +%Y%m%d%H%M%S)"
gcloud builds submit "$HERE" --project=fuzzthehuzz-499122 --tag="$IMAGE"
gcloud run services update novaris-rammerhead --project=fuzzthehuzz-499122 --region=us-south1 --image="$IMAGE"
echo 'Backend updated. Close existing proxy tabs, refresh Novaris, and open a new Rammerhead tab.'
