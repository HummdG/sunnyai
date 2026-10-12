# --- SunScan roof assessments: model storage and the job queue -----------------
# The API stores each assessment's 3D model (GLB + spec) in a private bucket and,
# once `api_base_url` is set, runs assessments through Cloud Tasks, which calls
# back into POST /internal/sunscan/run with an OIDC token for a dedicated
# service account. See docs/integration/sunscan-live-run.md.

resource "google_project_service" "storage" {
  service            = "storage.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "cloudtasks" {
  service            = "cloudtasks.googleapis.com"
  disable_on_destroy = false
}

# Private: uniform bucket-level access and public access prevention enforced,
# so no object can be made public by an ACL. Objects are keyed
# sunscan/<tenant>/<assessment>/<file>.
resource "google_storage_bucket" "sunscan_artefacts" {
  name                        = "${var.project_id}-sunscan-${local.name_suffix}"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  depends_on = [google_project_service.storage]
}

# The API's runtime identity reads and writes the model files; nothing else does.
resource "google_storage_bucket_iam_member" "api_writes_artefacts" {
  bucket = google_storage_bucket.sunscan_artefacts.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}

resource "google_cloud_tasks_queue" "sunscan" {
  name     = "sunscan-${local.name_suffix}"
  location = var.region

  # One assessment at a time per instance is the engine's design (it is
  # CPU-bound and calls rate-limited open-data hosts); a small dispatch rate
  # keeps the open-data providers within their usage policies.
  rate_limits {
    max_dispatches_per_second = 1
    max_concurrent_dispatches = 2
  }

  retry_config {
    max_attempts       = 5
    min_backoff        = "10s"
    max_backoff        = "300s"
    max_doublings      = 4
    max_retry_duration = "3600s"
  }

  depends_on = [google_project_service.cloudtasks]
}

# The identity Cloud Tasks signs its OIDC tokens as. The API accepts a task only
# with a token for this account (SUNSCAN_TASKS_SERVICE_ACCOUNT).
resource "google_service_account" "sunscan_tasks" {
  account_id   = "sunny-sunscan-tasks-${local.name_suffix}"
  display_name = "Sunny SunScan task invoker (${var.environment})"
}

# The API creates tasks on the queue...
resource "google_cloud_tasks_queue_iam_member" "api_enqueues" {
  name     = google_cloud_tasks_queue.sunscan.name
  location = var.region
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.api.email}"
}

# ...and names the invoker account on them, which requires actAs on it.
resource "google_service_account_iam_member" "api_acts_as_tasks_invoker" {
  service_account_id = google_service_account.sunscan_tasks.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.api.email}"
}

# The invoker may call the API even when the service is not public.
resource "google_cloud_run_v2_service_iam_member" "tasks_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.sunscan_tasks.email}"
}
