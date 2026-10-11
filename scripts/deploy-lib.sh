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

  step 'Build'
  npm run build:widget || die 'the widget bundle failed to build.'
  say '  widget bundle built'
  # The marketing site is a Next app with real source (`apps/marketing/app`), so
  # it is built here rather than skipped: a deploy that does not build the thing
  # it deploys is not a deploy. The check is for its config file, not for a
  # `src/` directory, because a Next app keeps its routes in `app/`.
  if [ -f apps/marketing/next.config.mjs ]; then
    npm run build:marketing || die 'the marketing site failed to build.'
    say '  marketing site built'
  else
    warn '  apps/marketing has no next.config.mjs, so the marketing site was not built.'
  fi
}

# ── where the deploy actually stops, and why ─────────────────────────────────

# Nothing above this line depends on a cloud account; nothing below it works
# yet. The rationale is in `README_DEPLOY.md` and DECISIONS.md D-37, and it is
# summarised here because a script that stops without saying why reads as a bug.
deploy_infrastructure_boundary() {
  target="$1"
  step "Deploy to $target"
  cat >&2 <<'BOUNDARY'
x The artefacts are built, but there is nothing to deploy them onto.

  Provisioning is Terraform's job and the configuration exists in
  infrastructure/terraform (validated in CI, never applied). What is missing is
  between the build and the deploy, in the order it has to happen:

  1. A container build.
     There is no Dockerfile and no `build:api`: the API runs from TypeScript
     sources through tsx, which is a development runner. Cloud Run needs an
     image, and Terraform's Artifact Registry repository exists to hold one
     nobody can build yet. This is the blocker; the three below are why the
     answer is not to build one today and push it.

  2. A store that survives Cloud Run.
     apps/api/src/store.ts writes conversations, leads and catalogues as files
     under SUNNY_DATA_DIR. A Cloud Run instance's filesystem is per-instance and
     ephemeral: two instances would hold two different sets of leads, and a
     scale event would drop the lot. ADR-006 records the swap to Firestore as
     the next step, and the Terraform configuration deliberately creates no
     database until that decision is made. Deploying the file store would ship a
     known data-loss bug.

  3. Terraform has never been applied.
     `terraform init`, `plan` and `apply` have not been run against any project,
     and there is no state bucket: `versions.tf` commits no backend block on
     purpose, so one is passed at init time. The first apply is unrehearsed, and
     a first apply against a live project is not a thing to do in a deploy
     script's critical path. scripts/bootstrap-google-cloud.sh is the front door
     to it, and it stops at its own confirmation.

  4. Hosting for the web apps.
     apps/marketing is a real Next app and does build (this script builds it),
     but there is no App Hosting backend and no firebase.json — and no decision
     about whether App Hosting will run it at all, because the app pins Next
     ^16.4.0 while the recorded capability finding for App Hosting names 15.2.x
     as the active minor and documents no Next 16. The dashboard (P10) does not
     exist, so it has no source to build either.

  What has been done instead is recorded in docs/STATUS.md, and the runbook
  that says what an operator will do once these exist is README_DEPLOY.md.
BOUNDARY
  exit 3
}

