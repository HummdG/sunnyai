#!/usr/bin/env sh
#
# Bootstrap the Google Cloud side of a Sunny deployment. §13's
# `scripts/bootstrap-google-cloud.sh`.
#
# Provisioning is Terraform's job, and the configuration for it is already in
# `infrastructure/terraform` (which has its own README). This script is the front
# door to it: it checks the toolchain, the account, the project, the billing
# account and the region *before* anything paid is created, runs `terraform
# init` / `plan` / `apply` against the named environment, and then does the one
# thing Terraform deliberately cannot do — puts a value into the model-credential
# secret, because Terraform state is readable by anyone with the state bucket and
# a credential that passes through it has leaked.
#
# It does not create the resources Terraform declares. Doing both is how two
# tools come to fight over the same secret: `google_secret_manager_secret` with
# an id that already exists is an error, not an adoption.
#
# Check-only by default. With no `--apply` it inspects and prints and changes
# nothing, which is the mode to run first and the mode that is safe repeatedly.
#
# Usage:
#   scripts/bootstrap-google-cloud.sh                                  # check only
#   scripts/bootstrap-google-cloud.sh --project p --apply
#   scripts/bootstrap-google-cloud.sh --project p --apply --set-gemini-key
#
# Environment:
#   TF_STATE_BUCKET   the GCS bucket holding Terraform state. Without it, state
#                     is written to infrastructure/terraform/terraform.tfstate
#                     (gitignored) and the script warns: local state is one
#                     laptop away from losing track of a live deployment.
#
# Exits 0 everything checked or applied, 1 a step failed, 2 not run (missing
# tool, missing argument, missing tfvars, or no confirmation).

set -eu

. "$(dirname -- "$0")/deploy-lib.sh"

root="$(repo_root)"
tf_dir='infrastructure/terraform'
project=''
region='europe-west2'
env_name='staging'
apply=0
set_gemini_key=0
gemini_secret='sunny-gemini-api-key'

while [ $# -gt 0 ]; do
  case "$1" in
    --project)
      [ $# -ge 2 ] || refuse '--project needs a project id.'
      project="$2"
      shift
      ;;
    --region)
      [ $# -ge 2 ] || refuse '--region needs a region, e.g. europe-west2.'
      region="$2"
      shift
      ;;
    --env)
      [ $# -ge 2 ] || refuse '--env needs staging or prod.'
      env_name="$2"
      shift
      ;;
    --secret)
      [ $# -ge 2 ] || refuse '--secret needs the model-credential secret id.'
      gemini_secret="$2"
      shift
      ;;
    --apply) apply=1 ;;
    --set-gemini-key) set_gemini_key=1 ;;
    --yes) ASSUME_YES=1 ;;
    -h | --help)
      sed -n '2,34p' "$0"
      exit 0
      ;;
    *) refuse "Unknown argument '$1'. Try --help." ;;
  esac
  shift
done
export ASSUME_YES="${ASSUME_YES:-0}"

# `staging` or `prod`, which is what `variables.tf` validates — not "production".
# A name this script accepted and Terraform refused would fail one command later
# with a less useful message.
case "$env_name" in
  staging | prod) ;;
  *) refuse "--env must be staging or prod, not '$env_name'." ;;
esac

tfvars="$tf_dir/env/$env_name.tfvars"

# ── 1. the toolchain ─────────────────────────────────────────────────────────

step 'Toolchain'
need node 'The build and the tests are npm scripts.'
need npm 'Terraform is driven from a checkout that has to build first.'
need gcloud 'It reads the project and the billing account, and adds the secret value.'
need terraform 'It is what provisions Cloud Run, Artifact Registry, the identity and the secrets.'
say "  node       $(version_of node)"
say "  npm        $(version_of npm)"
say "  gcloud     $(version_of gcloud)"

# `versions.tf` requires `>= 1.9`; check it here rather than one apply later.
tf_version="$(terraform version -json 2>/dev/null | json_field terraform_version || true)"
if [ -z "$tf_version" ]; then
  warn '  terraform  could not parse `terraform version -json`; versions.tf requires >= 1.9'
else
  say "  terraform  v$tf_version (versions.tf requires >= 1.9)"
  tf_major="${tf_version%%.*}"
  tf_rest="${tf_version#*.}"
  tf_minor="${tf_rest%%.*}"
  case "$tf_major" in '' | *[!0-9]*) tf_major=0 ;; esac
  case "$tf_minor" in '' | *[!0-9]*) tf_minor=0 ;; esac
  if [ "$tf_major" -lt 1 ] || { [ "$tf_major" -eq 1 ] && [ "$tf_minor" -lt 9 ]; }; then
    refuse "Terraform $tf_version is older than the >= 1.9 that infrastructure/terraform requires."
  fi
fi

if [ -f "$tfvars" ]; then
  say "  tfvars     $tfvars"
else
  warn "  tfvars     $tfvars is not there; copy env/example.tfvars.example and fill it in before --apply"
fi

# ── 2. the project, the account and the billing ──────────────────────────────

step 'Project and account'
account="$(gcloud config get-value account 2>/dev/null || true)"
say "  account     ${account:-<none active>}"
say "  project     ${project:-<not given>}"
say "  region      $region"
say "  environment $env_name"

if [ "$apply" = "1" ] && [ -z "$project" ]; then
  refuse '--apply needs --project. It is what the resources are named after, and a wrong one is discovered from a bill.'
fi

if [ -n "$project" ]; then
  if gcloud projects describe "$project" --format='value(projectId)' >/dev/null 2>&1; then
    say '  project is reachable'
  else
    refuse "The active account cannot read project '$project'. Check the id and 'gcloud auth list'."
  fi

  # Billing is what turns a mistake here into an invoice, so it is read and
  # printed rather than assumed. A failure to read it is reported as exactly
  # that, because it usually means the account has no billing role.
  billing="$(gcloud billing projects describe "$project" --format='value(billingAccountName)' 2>/dev/null || true)"
  if [ -n "$billing" ]; then
    say "  billing     $billing"
  else
    warn '  billing     could not be read for this project — confirm it in the console before --apply'
  fi
fi

if [ "$apply" != "1" ]; then
  step 'Nothing was changed'
  say '  This is check-only. Re-run with --apply --project <id> to provision.'
  say ''
  say "  What --apply would do, in $tf_dir:"
  say "    terraform init -backend-config=\"bucket=\${TF_STATE_BUCKET}\" -backend-config=\"prefix=sunny/$env_name\""
  say "    terraform plan  -var-file=\"env/$env_name.tfvars\""
  say "    terraform apply -var-file=\"env/$env_name.tfvars\""
  say ''
  say '  And then, out of band, the one value Terraform must not hold:'
  say "    --set-gemini-key   (adds a version to $gemini_secret, read from the terminal, never echoed)"
  exit 0
fi

# ── 3. the paid-resource gate ────────────────────────────────────────────────

step 'About to provision'
say "  project:     $project"
say "  region:      $region"
say "  environment: $env_name"
say "  tfvars:      $( [ -f "$tfvars" ] && printf '%s' "$tfvars" || printf 'MISSING')"
cat <<'CREATES'
  Terraform will create, if they do not already exist:

    Cloud Run v2 service sunny-api-<env>   (billed by request and instance time)
    Artifact Registry repository           (billed by image storage)
    service account sunny-api-<env>        (free)
    Secret Manager secrets                 (near-free at this volume)
    random_password, the session secret    (free)

  It creates no database: the API persists to a file store today and the managed
  database is an unmade decision (ADR-006). It also does not deploy the image —
  `ignore_changes` is set on it, so a deploy is a separate, deliberate step.
CREATES
confirm 'Provision this project?' || {
  say '  not confirmed, so nothing was done.'
  exit 2
}

if [ ! -f "$tfvars" ]; then
  refuse "$tfvars is missing. Copy $tf_dir/env/example.tfvars.example to it and fill in project_id, api_image and allowed_origins."
fi

# ── 4. Terraform ─────────────────────────────────────────────────────────────

step 'Terraform init'
if [ -n "${TF_STATE_BUCKET:-}" ]; then
  terraform -chdir="$tf_dir" init -input=false \
    -backend-config="bucket=$TF_STATE_BUCKET" \
    -backend-config="prefix=sunny/$env_name" ||
    die 'terraform init failed.'
  say "  state: gs://$TF_STATE_BUCKET/sunny/$env_name"
else
  warn '  TF_STATE_BUCKET is not set, so state goes to a local file. That is fine for a first experiment and wrong for a deployment anyone else has to operate: lose the file and the next apply proposes creating what already exists.'
  terraform -chdir="$tf_dir" init -input=false || die 'terraform init failed.'
fi

step 'Terraform plan'
# `apply` re-plans, but the plan is printed here on its own so the change set is
# readable in the log before the gate below acts on it, and so a plan that fails
# does not leave a half-applied change set behind.
terraform -chdir="$tf_dir" plan -input=false -var-file="env/$env_name.tfvars" -var="project_id=$project" -var="region=$region" -var="environment=$env_name" ||
  die 'terraform plan failed. Nothing was applied.'

step 'Terraform apply'
confirm "Apply this plan to $project?" || {
  say '  not confirmed: init and plan ran, apply did not.'
  exit 2
}
terraform -chdir="$tf_dir" apply -input=false -auto-approve -var-file="env/$env_name.tfvars" -var="project_id=$project" -var="region=$region" -var="environment=$env_name" ||
  die 'terraform apply failed. Run it again by hand to see the full output.'

step 'What was created'
for output_name in api_url api_service_account artifact_registry gemini_api_key_secret_id; do
  value="$(terraform -chdir="$tf_dir" output -raw "$output_name" 2>/dev/null || true)"
  say "  $output_name: ${value:-<unavailable>}"
done

# ── 5. the one value Terraform must not hold ─────────────────────────────────

if [ "$set_gemini_key" = "1" ]; then
  step 'Model credential'
  if [ ! -t 0 ]; then
    refuse 'The key is read from the terminal and this stdin is not one. Run it interactively.'
  fi
  if ! gcloud secrets describe "$gemini_secret" --project "$project" >/dev/null 2>&1; then
    refuse "'$gemini_secret' is not in $project yet, so there is nothing to add a version to. Run --apply first, or set --secret to the id Terraform reports."
  fi
  printf '  %s: paste the model API key (not echoed, then enter): ' "$gemini_secret" >&2
  read -r key_value || refuse 'no value read.'
  printf '\n' >&2
  if [ -z "$key_value" ]; then
    warn "  empty, so no version was added. Chat stays unavailable until one is."
  else
    # Piped, never echoed, never written to a file, and unset immediately. The
    # `--data-file=-` form is what keeps it out of the process arguments, where
    # any user on the machine could read it from the process list.
    printf '%s' "$key_value" | gcloud secrets versions add "$gemini_secret" \
      --data-file=- --project "$project" >/dev/null ||
      die "could not add a version to $gemini_secret"
    say '  a new version was added; Cloud Run picks up :latest on the next revision'
  fi
  unset key_value
else
  step 'Model credential — still outstanding'
  warn "  $gemini_secret has no value, so /healthz will report chat as unavailable and the assistant will refuse rather than pretend. Add it with --set-gemini-key, or by hand:"
  say "    printf '%s' \"\$GEMINI_API_KEY\" | gcloud secrets versions add $gemini_secret --project $project --data-file=-"
fi

# ── 6. what Terraform does not do, and what is still missing ─────────────────

step 'What is still manual'
cat <<MANUAL
    Firestore, if it is the database that is chosen:

      gcloud firestore databases create \\
        --project $project --location $region --type firestore-native

    The location is permanent, and it is not in infrastructure/terraform on
    purpose — it is a decision about where an installer's visitors are, not a
    resource this configuration should invent. Terraform creates no database at
    all today (ADR-006).

    The state bucket, once per environment. Terraform cannot create the bucket
    that holds its own state, so it is made by hand before the first
    \`terraform init\` that names it.

    Budget alerts (Billing > Budgets & alerts), on the project that runs the API.
    §11 asks for thresholds measured from the first staging build; there is no
    staging build yet, so any number set today would be invented.

    The images. \`ignore_changes\` is set on both container images, so Terraform
    deploys whatever \`api_image\` and \`web_image\` named and never moves them
    afterwards: push both before the first apply (apps/api/Dockerfile and
    apps/marketing/Dockerfile; scripts/deploy-staging.sh builds them).
MANUAL

step 'What is still missing'
cat <<'MISSING'
  Nothing in the repository: both images build, the API stores everything in
  the Firestore database this configuration creates, the website runs as its
  own Cloud Run service, and uptime checks alert \`alert_email\`. What a first
  apply still needs is outside it: a project, a state bucket, the Gemini key and
  (for billing) the Stripe secrets in Secret Manager, and both images pushed.
  README_DEPLOY.md is the runbook.
MISSING

say ''
say "bootstrap finished against $project ($env_name)."
