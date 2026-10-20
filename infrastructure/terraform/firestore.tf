# --- Firestore: the operational database ---------------------------------------
# Conversations, leads, installers, catalogues and knowledge live here
# (apps/api/src/firestore-store.ts). Cloud Run's disk does not outlive an
# instance, so without this the API would lose every enquiry at the next deploy
# -- which is why production refuses to boot with no store chosen.
#
# One named database per environment rather than the project's "(default)",
# so staging and production can share a project without sharing data.
#
# No composite indexes: every query in the store needs only the single-field
# indexes Firestore maintains itself, and apps/api/test/firestore-indexes.test.ts
# keeps it that way (docs/firestore.md).

resource "google_project_service" "firestore" {
  project            = var.project_id
  service            = "firestore.googleapis.com"
  disable_on_destroy = false
}

resource "google_firestore_database" "sunny" {
  project     = var.project_id
  name        = local.firestore_database
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"

  # Production data is never one `terraform destroy` away from gone: deletion
  # is refused by Firestore itself, and Terraform leaves the database behind if
  # the resource is removed from configuration.
  delete_protection_state = var.environment == "prod" ? "DELETE_PROTECTION_ENABLED" : "DELETE_PROTECTION_DISABLED"
  deletion_policy         = var.environment == "prod" ? "ABANDON" : "DELETE"

  # Seven days of point-in-time recovery: the undo for a bad migration or a
  # mistaken bulk delete.
  point_in_time_recovery_enablement = var.environment == "prod" ? "POINT_IN_TIME_RECOVERY_ENABLED" : "POINT_IN_TIME_RECOVERY_DISABLED"

  depends_on = [google_project_service.firestore]
}

# The API reads and writes documents; it administers nothing.
resource "google_project_iam_member" "api_uses_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.api.email}"
}
