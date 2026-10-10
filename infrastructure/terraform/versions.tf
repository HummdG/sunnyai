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

  # No backend block is committed. The state bucket is per-environment and
  # naming it here would put one environment's bucket in every checkout. Pass it
  # at init time instead:
  #
  #   terraform init -backend-config=env/prod.backend.hcl
  #
  # CI runs `init -backend=false` and validates only, so it never needs state.
}
