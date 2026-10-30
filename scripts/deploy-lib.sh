# Shared helpers for the scripts in this directory. Sourced, never executed:
#
#   . "$(dirname -- "$0")/deploy-lib.sh"
#
# POSIX sh on purpose. These are run on a developer's machine, in Git Bash on
# Windows and in a shell on Linux, and nothing here needs bash. The repository's
# own tooling is Node; this is only the glue that calls it.

say() { printf '%s\n' "$*"; }
warn() { printf '! %s\n' "$*" >&2; }
die() { printf 'x %s\n' "$*" >&2; exit 1; }
# Nothing was attempted, and the script is not going to guess: the caller asked
# for something that is not there. Distinct from `die` on purpose, because an
# operator (and a wrapper script) should be able to tell "I could not do it"
# from "I did not start".
refuse() { printf 'x %s\n' "$*" >&2; exit 2; }
step() { printf '\n== %s\n' "$*"; }

# A command that must exist, with the reason it is needed, so a missing tool
# says why rather than just not being found.
need() {
  command -v "$1" >/dev/null 2>&1 || refuse "$1 is not on PATH. $2"
}

# The repository root, so a script can be run from anywhere.
repo_root() {
  CDPATH= cd -- "$(dirname -- "$0")/.." && pwd
}

# The version of a command, for the record in a deploy log.
version_of() {
  "$1" --version 2>/dev/null | head -n 1 || printf '%s\n' "(no --version)"
}

# A yes/no gate. Defaults to no: an unattended script must never take the
# destructive branch because nobody was there to answer.
confirm() {
  if [ "${ASSUME_YES:-0}" = "1" ]; then
    say "  (--yes) ${1}"
    return 0
  fi
  printf '%s [y/N] ' "$1"
  # EOF (a pipe, a closed terminal, `</dev/null`) is a no. `read` failing must
  # not fall through to the destructive branch, and under `set -e` it must not
  # take the script down either.
  read -r answer || answer=""
  case "$answer" in
    y | Y | yes | YES) return 0 ;;
    *) return 1 ;;
  esac
}

# JSON on stdin, a value on stdout. Node is already a hard requirement of the
# repository, so this does not add one, and it removes any dependence on jq
# being installed.
json_field() {
  node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => (raw += chunk));
    process.stdin.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        process.exit(2);
      }
      const found = process.argv[1]
        .split(".")
        .reduce((node, key) => (node == null ? undefined : node[key]), parsed);
      if (found === undefined || found === null) process.exit(3);
      process.stdout.write(typeof found === "string" ? found : JSON.stringify(found));
    });
  ' "$1"
}

# ── the two steps every deploy shares ────────────────────────────────────────

# The tree must be clean, because a deploy ships a commit and a dirty tree means
# what is being shipped is not what is in the repository. `--allow-dirty` exists
# for a deliberate hotfix from a working tree; it is not the default, because a
# deploy that cannot be reproduced from a commit cannot be rolled back to
# either.
deploy_require_clean_tree() {
  if ! command -v git >/dev/null 2>&1; then
    warn 'git is not on PATH, so the tree cannot be checked for uncommitted changes.'
    return 0
  fi
  if [ -n "$(git status --porcelain)" ]; then
    if [ "${ALLOW_DIRTY:-0}" = "1" ]; then
      warn '--allow-dirty: shipping uncommitted changes.'
      return 0
    fi
    git status --short >&2
    die 'There are uncommitted changes. Commit them, or pass --allow-dirty to ship the working tree.'
  fi
  say "  tree clean at $(git rev-parse --short HEAD)"
}

# The local half of a deploy: everything up to the point where a remote
# resource has to exist. It is the same in every environment because it is the
# same repository being built.
deploy_build_locally() {
  step 'Verify'
  npm run verify || die 'npm run verify failed. Nothing is deployed from a tree that does not pass its own checks.'
  say '  format, lint, typecheck and unit/contract/integration tests all passed'

  step 'Build the images'
  need docker 'The API and the website ship as container images.'
  # Tagged with the commit, so a deployment names exactly what it runs and a
  # rollback is a change of tag (README_DEPLOY.md).
  DEPLOY_TAG="$(git rev-parse --short HEAD 2>/dev/null || echo local)"
  docker build -f apps/api/Dockerfile -t "sunny-api:$DEPLOY_TAG" . \
    || die 'the API image failed to build.'
  say "  sunny-api:$DEPLOY_TAG"
  # The website's NEXT_PUBLIC_* settings are compiled into its pages, so they
  # come from this shell's environment at build time (apps/marketing/Dockerfile).
  for name in NEXT_PUBLIC_SUNNY_API_URL NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN NEXT_PUBLIC_FIREBASE_PROJECT_ID; do
    eval "value=\${$name:-}"
    [ -n "$value" ] || warn "  $name is not set; the website image is built without it."
  done
  docker build -f apps/marketing/Dockerfile -t "sunny-web:$DEPLOY_TAG" \
    --build-arg NEXT_PUBLIC_SUNNY_API_URL --build-arg NEXT_PUBLIC_SUNNY_WIDGET_ID \
    --build-arg NEXT_PUBLIC_SITE_URL \
    --build-arg NEXT_PUBLIC_FIREBASE_API_KEY --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID . \
    || die 'the website image failed to build.'
  say "  sunny-web:$DEPLOY_TAG"
}

# ── where the deploy actually stops, and why ─────────────────────────────────

# Nothing above this line depends on a cloud account; nothing below it works
# yet. The rationale is in `README_DEPLOY.md` and DECISIONS.md D-37, and it is
# summarised here because a script that stops without saying why reads as a bug.
deploy_infrastructure_boundary() {
  target="$1"
  step "Deploy to $target"
  cat >&2 <<BOUNDARY
x The images are built (sunny-api:$DEPLOY_TAG, sunny-web:$DEPLOY_TAG), and
  pushing them needs a provisioned project, which this script does not create.

  The one step left is the first Terraform apply, against a real project and
  with a state bucket (scripts/bootstrap-google-cloud.sh is the front door, and
  it stops at its own confirmation). It has never been run. After it:

    REPO=\$(terraform -chdir=infrastructure/terraform output -raw artifact_registry)
    gcloud auth configure-docker "\${REPO%%/*}"
    docker tag sunny-api:$DEPLOY_TAG "\$REPO/sunny-api:$DEPLOY_TAG" && docker push "\$REPO/sunny-api:$DEPLOY_TAG"
    docker tag sunny-web:$DEPLOY_TAG "\$REPO/sunny-web:$DEPLOY_TAG" && docker push "\$REPO/sunny-web:$DEPLOY_TAG"
    gcloud run deploy sunny-api-$target --image "\$REPO/sunny-api:$DEPLOY_TAG" --region <region>
    gcloud run deploy sunny-web-$target --image "\$REPO/sunny-web:$DEPLOY_TAG" --region <region>
    scripts/smoke-test.sh <api url>

  The full runbook is README_DEPLOY.md.
BOUNDARY
  exit 3
}

