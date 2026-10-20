output "api_url" {
  description = "The service URL. This is what `data-api-url` in the widget snippet points at."
  value       = google_cloud_run_v2_service.api.uri
}

output "api_service_account" {
  description = "Runtime identity. Grant it access to anything else the API needs."
  value       = google_service_account.api.email
}

output "artifact_registry" {
  description = "Docker repository to push images to, in the form IMAGE_PATH."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.api.repository_id}"
}

output "gemini_api_key_secret_id" {
  description = <<-EOT
    Secret whose value must be set out of band before the first chat turn will
    work. `capabilityReport` reports chat as unavailable until it is.
  EOT
  value       = google_secret_manager_secret.gemini_api_key.secret_id
}

output "sunscan_artefact_bucket" {
  description = "Private bucket holding SunScan 3D models (SUNSCAN_ARTEFACT_BUCKET)."
  value       = google_storage_bucket.sunscan_artefacts.name
}

output "sunscan_tasks_queue" {
  description = "Cloud Tasks queue for SunScan assessments (used once api_base_url is set)."
  value       = google_cloud_tasks_queue.sunscan.id
}

output "web_url" {
  description = "The website and dashboard's service URL, until a custom domain is mapped."
  value       = google_cloud_run_v2_service.web.uri
}

output "firestore_database" {
  description = "The environment's Firestore database (SUNNY_FIRESTORE_DATABASE)."
  value       = google_firestore_database.sunny.name
}

output "stripe_secret_ids" {
  description = "Secrets to fill out of band before setting stripe_enabled = true."
  value = [
    google_secret_manager_secret.stripe_secret_key.secret_id,
    google_secret_manager_secret.stripe_webhook_secret.secret_id,
  ]
}
