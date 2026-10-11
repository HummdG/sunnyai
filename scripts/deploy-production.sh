#!/usr/bin/env sh
#
# Deploy to production. §13's `scripts/deploy-production`.
#
# The difference from `deploy-staging.sh` is not the build — it is the two extra
# gates before anything reaching a visitor changes:
#
#   * `--yes`, or an interactive confirmation, naming the project and the
#     revision being replaced. Production is the one place where a script must
#     not act because it was invoked.
#   * the full suite, end to end in a browser, because staging deployment's
#     value is that production does not have to be where a rendering bug is
#     found.
#
# It stops at the same infrastructure boundary staging does (exit 3): there is
# nothing to deploy onto yet. See `README_DEPLOY.md`.
#
# Usage:
#   scripts/deploy-production.sh [--yes] [--allow-dirty] [--skip-e2e]
#
# Exits 0 deployed, 1 the tree failed its own checks, 2 not run (missing tool or
# no confirmation), 3 nothing to deploy onto.

set -eu

. "$(dirname -- "$0")/deploy-lib.sh"

ALLOW_DIRTY=0
for argument in "$@"; do
  case "$argument" in
    --yes) ASSUME_YES=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --skip-e2e) SKIP_E2E=1 ;;
    -h | --help) sed -n '2,21p' "$0"; exit 0 ;;
    *) refuse "Unknown argument '$argument'. Try --help." ;;
  esac
done
export ASSUME_YES="${ASSUME_YES:-0}"

need node 'The build and the verification both run through Node.'
need npm 'The scripts it runs are npm scripts.'

say 'Deploying to production'
step 'Preflight'
deploy_require_clean_tree
say "  node $(version_of node)"

deploy_build_locally

step 'End-to-end suite'
if [ "${SKIP_E2E:-0}" = "1" ]; then
  warn '  --skip-e2e: the browser suite was not run against this build.'
elif [ "${CI:-}" = "" ]; then
  # The suite starts its own servers on fixed ports and refuses to reuse a
  # running one on the peers that serve a built artefact, so it needs the ports
  # free. Saying that here is cheaper than the EADDRINUSE it would otherwise
  # fail with.
  say '  (needs ports 4173-4176, 4180 and 8787 free; see playwright.config.ts)'
  npx playwright test || die 'the end-to-end suite failed. Production is not the place to find out.'
else
  npm run test:e2e || die 'the end-to-end suite failed.'
fi
say '  the browser suite passed'

# ── the gate ─────────────────────────────────────────────────────────────────

step 'Confirmation'
project="${SUNNY_GCP_PROJECT:-<SUNNY_GCP_PROJECT is not set>}"
region="${SUNNY_REGION:-<SUNNY_REGION is not set>}"
say "  project: $project"
say "  region:  $region"
say "  commit:  $(git rev-parse --short HEAD 2>/dev/null || printf 'unknown')"
if ! confirm 'Deploy this commit to production?'; then
  say '  not confirmed, so nothing was done.'
  exit 2
fi

deploy_infrastructure_boundary production
