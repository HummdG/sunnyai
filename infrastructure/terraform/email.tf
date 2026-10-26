# --- Email Assistant: Gmail ----------------------------------------------------
# What the API needs to connect an installer's Gmail and hear about new mail
# (docs/integration/email-assistant.md): a key for mailbox tokens at rest, the
# OAuth client's secret, and a Pub/Sub topic Gmail publishes to, pushed to the
# API with a secret token in the URL.
#
# The OAuth client itself is made by hand in the console (Google Auth Platform
# has no Terraform resource); its id goes in var.google_oauth_client_id and its
# secret into the secret below with `gcloud secrets versions add`, never through
# Terraform state. Nothing is mounted until var.gmail_enabled is set, because
# Cloud Run refuses a revision whose secret has no version yet.

resource "google_project_service" "gmail" {
  project            = var.project_id
  service            = "gmail.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "pubsub" {
  project            = var.project_id
  service            = "pubsub.googleapis.com"
  disable_on_destroy = false
}

# Mailbox refresh tokens are encrypted with this (AES-256-GCM, 32 bytes).
resource "random_bytes" "email_token_key" {
  length = 32
}

resource "google_secret_manager_secret" "email_token_key" {
  project   = var.project_id
  secret_id = "sunny-email-token-key-${local.name_suffix}"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "email_token_key" {
  secret      = google_secret_manager_secret.email_token_key.id
  secret_data = random_bytes.email_token_key.base64
}

# Created empty; the value is added out of band (see the header).
resource "google_secret_manager_secret" "google_oauth_client_secret" {
  project   = var.project_id
  secret_id = "sunny-google-oauth-client-secret-${local.name_suffix}"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

# The token Pub/Sub presents on every push: the endpoint is public, and this is
# what makes a push from anyone else a 401.
resource "random_password" "gmail_push_token" {
  length  = 40
  special = false
}

resource "google_secret_manager_secret" "gmail_push_token" {
  project   = var.project_id
  secret_id = "sunny-gmail-push-token-${local.name_suffix}"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "gmail_push_token" {
  secret      = google_secret_manager_secret.gmail_push_token.id
  secret_data = random_password.gmail_push_token.result
}

resource "google_secret_manager_secret_iam_member" "api_reads_email" {
  for_each = {
    token_key     = google_secret_manager_secret.email_token_key.secret_id
    client_secret = google_secret_manager_secret.google_oauth_client_secret.secret_id
    push_token    = google_secret_manager_secret.gmail_push_token.secret_id
  }
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_pubsub_topic" "gmail" {
  project = var.project_id
  name    = "sunny-gmail-${local.name_suffix}"
  labels  = local.labels

  depends_on = [google_project_service.pubsub]
}

# Gmail publishes a mailbox's changes as this fixed Google account.
resource "google_pubsub_topic_iam_member" "gmail_publishes" {
  project = var.project_id
  topic   = google_pubsub_topic.gmail.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:gmail-api-push@system.gserviceaccount.com"
}

resource "google_pubsub_subscription" "gmail_push" {
  count   = var.api_base_url == "" ? 0 : 1
  project = var.project_id
  name    = "sunny-gmail-push-${local.name_suffix}"
  topic   = google_pubsub_topic.gmail.id
  labels  = local.labels

  ack_deadline_seconds       = 60
  message_retention_duration = "86400s"

  push_config {
    push_endpoint = "${var.api_base_url}/v1/webhooks/gmail-push?token=${random_password.gmail_push_token.result}"
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "300s"
  }
}
