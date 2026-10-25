terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    # Used once, to generate each environment's session secret. A secret that is
    # the same in staging and production is a secret that lets staging forge a
    # production session.
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State lives in a GCS bucket, but the bucket is not named here: it is
  # per-environment, and naming it would put one environment's bucket in every
  # checkout. Pass it at init time instead:
  #
  #   terraform init -backend-config="bucket=<state bucket>"   #     -backend-config="prefix=sunny/<env>"
  #
  # The block itself must exist: without it, Terraform ignores -backend-config
  # with only a warning and keeps state in a local file.
  #
  # CI runs `init -backend=false` and validates only, so it never needs state.
  backend "gcs" {}
}
