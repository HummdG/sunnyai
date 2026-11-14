# --- Home data lookups ---------------------------------------------------------
# What Sunny looks up from a visitor's address instead of asking them
# (apps/api/src/homedata): Google's roof model for solar, the energy certificate
# register for heat pumps. Each is on only while its secret is mounted.
#
# The secrets were created by hand (2026-11-14) with their values, so they are
# imported here rather than created; like the Gemini key, the values never pass
# through Terraform state.
#
# - sunny-epc-api-token: the bearer token from
#   get-energy-performance-data.communities.gov.uk (the owner's account).
# - sunny-google-maps-api-key: a key restricted to the Solar and Geocoding
#   APIs. Its spend is capped by quota overrides set outside Terraform:
#   FindClosestBuildingInsights 20/min, Solar's other methods 0, Geocoding
#   300/day.

locals {
  home_data_secrets = {
    EPC_API_TOKEN       = "sunny-epc-api-token"
    GOOGLE_MAPS_API_KEY = "sunny-google-maps-api-key"
  }
}

import {
  to = google_secret_manager_secret.home_data["EPC_API_TOKEN"]
  id = "projects/${var.project_id}/secrets/sunny-epc-api-token"
}

import {
  to = google_secret_manager_secret.home_data["GOOGLE_MAPS_API_KEY"]
  id = "projects/${var.project_id}/secrets/sunny-google-maps-api-key"
}

resource "google_secret_manager_secret" "home_data" {
  for_each  = local.home_data_secrets
  project   = var.project_id
  secret_id = each.value

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_iam_member" "api_reads_home_data" {
  for_each  = google_secret_manager_secret.home_data
  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}
