#!/usr/bin/env sh
#
# Roll back a deployment. §13's `scripts/rollback`.
#
# What this can honestly do today: nothing. No service has been deployed, so
# there is no revision to return to, and a script that pretended otherwise would
# be at its most dangerous during an incident — which is exactly when nobody
# reads it carefully. What it does instead is check whether a deployment exists,
# and if one does, print the procedure and the one thing that does not roll back
# with the code.
#
# Usage:
#   scripts/rollback.sh [--target revision]
#
# Environment:
#   SUNNY_GCP_PROJECT   the project the service lives in
#   SUNNY_REGION        the region the service lives in
#   SUNNY_SERVICE       the Cloud Run service name, default sunny-api
#
# Exits 0 rolled back, 2 not run (missing tool or no project), 3 nothing to roll
# back to.

set -eu

. "$(dirname -- "$0")/deploy-lib.sh"

target=''
service="${SUNNY_SERVICE:-sunny-api}"
project="${SUNNY_GCP_PROJECT:-}"
region="${SUNNY_REGION:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --target)
      [ $# -ge 2 ] || refuse '--target needs a revision name.'
      target="$2"
      shift
      ;;
    -h | --help)
      sed -n '2,24p' "$0"
      exit 0
      ;;
    *) refuse "Unknown argument '$1'. Try --help." ;;
  esac
  shift
done

step 'What exists'
if ! command -v gcloud >/dev/null 2>&1; then
  warn 'gcloud is not on PATH, so this cannot tell what is deployed.'
elif [ -z "$project" ] || [ -z "$region" ]; then
  warn 'SUNNY_GCP_PROJECT and SUNNY_REGION are not both set, so there is nothing to look at.'
else
  if gcloud run services describe "$service" --project "$project" --region "$region" \
    --format='value(status.url)' 2>/dev/null; then
    die "A '$service' service exists in $project/$region, and this script still has no rollback path: no image is built by this repository (see README_DEPLOY.md), so a previous revision's image is not something these scripts know how to produce. Roll back in the Cloud Run console, and treat this as a defect in scripts/rollback.sh to fix before the next deploy."
  fi
  say "  no '$service' service in $project/$region"
fi

step 'What a rollback will be'
cat <<'RUNBOOK'
  Once the API is deployed (README_DEPLOY.md lists what has to exist first),
  a rollback is a traffic move to a previous revision, not a rebuild:

    gcloud run services update-traffic <service> \
      --to-revisions <revision>=100 --region <region> --project <project>

  Three things this cannot do, which belong in the runbook now rather than
  being discovered in the middle of an incident:

  1. It does not undo data. A revision that wrote to the store keeps having
     written to it: a schema change, a backfill or a bad catalogue upload is
     not reverted by serving older code. That is why the store's own
     backup/restore drill (README_DEPLOY.md) is a separate procedure.
  2. It does not undo a secret rotation. If SESSION_SECRET was rotated, every
     session issued under the old key is already invalid whichever revision
     answers.
  3. It does not undo a widget bundle a customer's page has cached. The
     bundle is served from the host app; a browser holding the previous one
     keeps running it until it revalidates.

  Before rolling back: record the current revision, decide whether the store
  needs restoring as well, and say which of the three above applies. A
  rollback nobody wrote down is an incident that happens twice.
RUNBOOK

warn 'Nothing has been deployed by these scripts, so there is nothing to roll back.'
exit 3
