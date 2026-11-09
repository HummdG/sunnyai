# --- Installer brand assets: uploaded logos -------------------------------------
# The API stores each installer's uploaded logo (PNG, plus the mask and outline it
# derives) in a private bucket, so they survive Cloud Run instances. The widget
# never reads the bucket: the API serves the pixels through its own routes.

# Private: uniform bucket-level access and public access prevention enforced,
# so no object can be made public by an ACL. Objects are keyed by tenant.
resource "google_storage_bucket" "brand_assets" {
  name                        = "${var.project_id}-brand-${local.name_suffix}"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  depends_on = [google_project_service.storage]
}

# The API's runtime identity reads and writes the logo files; nothing else does.
resource "google_storage_bucket_iam_member" "api_writes_brand" {
  bucket = google_storage_bucket.brand_assets.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}
