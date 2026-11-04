# --- The staff dashboard's reads (apps/api/src/ops, /admin on the website) ---------
# The dashboard shows live infrastructure from Cloud Monitoring and actual spend
# from the GCP billing export. The API reads both as its own service account,
# so that account gets read-only roles here and nothing that can change either.
#
# One step cannot be done from Terraform: the billing export itself is switched
# on per *billing account*, in the console (Billing > Billing export > BigQuery
# export > Detailed usage cost), pointed at the dataset below. Google creates
# the table a few hours later, named gcp_billing_export_resource_v1_<ACCOUNT>;
# put its full id in `ops_billing_table` and apply again. README_DEPLOY.md has
# the steps.

resource "google_project_service" "bigquery" {
  project            = var.project_id
  service            = "bigquery.googleapis.com"
  disable_on_destroy = false
}

# Where the billing export writes. In the region the rest of Sunny lives in, so
# billing data stays in the same jurisdiction as the customer data.
resource "google_bigquery_dataset" "billing_export" {
  project       = var.project_id
  dataset_id    = "billing_export_${replace(local.name_suffix, "-", "_")}"
  friendly_name = "Sunny billing export (${var.environment})"
  description   = "Cloud Billing's detailed export, read by the staff dashboard's Costs page."
  location      = var.region

  # The export is Google's to write and grows by a few MB a month; losing it
  # loses cost history that cannot be re-exported, so it is never destroyed
  # with the stack.
  delete_contents_on_destroy = false

  depends_on = [google_project_service.bigquery]
}

# Read the export, and run the queries that read it. No write access anywhere.
resource "google_bigquery_dataset_iam_member" "api_reads_billing" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.billing_export.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.api.email}"
}

# A billing account exports to one dataset, and staging and production share one
# account. The environment that holds the export lets the others' API accounts
# read it; their queries filter on their own project, so each sees its own spend.
resource "google_bigquery_dataset_iam_member" "others_read_billing" {
  for_each   = toset(var.ops_billing_readers)
  project    = var.project_id
  dataset_id = google_bigquery_dataset.billing_export.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${each.value}"
}

resource "google_project_iam_member" "api_runs_queries" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.api.email}"
}

# Request counts, latencies, instances, uptime checks and the load balancer's
# 429s, for the Health page.
resource "google_project_iam_member" "api_reads_monitoring" {
  project = var.project_id
  role    = "roles/monitoring.viewer"
  member  = "serviceAccount:${google_service_account.api.email}"
}

# Errors the API recorded are kept for 30 days: the API writes `expireAt` on
# each one (ops/ledger.ts) and Firestore deletes them after it.
resource "google_firestore_field" "ops_errors_ttl" {
  project    = var.project_id
  database   = google_firestore_database.sunny.name
  collection = "ops_errors"
  field      = "expireAt"

  ttl_config {}

  # The TTL field needs no index of its own.
  index_config {}
}
