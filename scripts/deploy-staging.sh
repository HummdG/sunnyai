#!/usr/bin/env sh
#
# Deploy to staging. §13's `scripts/deploy-staging`.
#
# Idempotent by construction: it runs the same checks and builds the same
# artefacts every time, and it does not mutate anything remote. Today it stops
# at `deploy_infrastructure_boundary` with exit 3 and a list of what is missing
# — see `README_DEPLOY.md`.
#
# Usage:
#   scripts/deploy-staging.sh [--allow-dirty]
#
# Exits 0 deployed, 1 the tree failed its own checks, 2 not run (missing tool),
# 3 nothing to deploy onto.

set -eu

. "$(dirname -- "$0")/deploy-lib.sh"

ALLOW_DIRTY=0
for argument in "$@"; do
  case "$argument" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -h | --help) sed -n '2,16p' "$0"; exit 0 ;;
    *) refuse "Unknown argument '$argument'. Try --help." ;;
  esac
done

need node 'The build and the verification both run through Node.'
need npm 'The scripts it runs are npm scripts.'

say 'Deploying to staging'
step 'Preflight'
deploy_require_clean_tree
say "  node $(version_of node)"

deploy_build_locally

# The staging smoke test runs after a deploy, not before one: it tests a
# deployment, and this script has not made one. `scripts/smoke-test.sh` is what
# runs it, and README_DEPLOY.md's runbook has it as the step after this.
deploy_infrastructure_boundary staging
