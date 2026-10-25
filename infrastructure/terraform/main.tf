provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  # A stable suffix keeps two environments in one project from colliding.
  name_suffix = var.environment
  api_name    = "sunny-api-${local.name_suffix}"
  web_name    = "sunny-web-${local.name_suffix}"
  # One Firestore database per environment (firestore.tf).
  firestore_database = "sunny-${local.name_suffix}"
  labels = {
    app         = "sunny"
    environment = var.environment
    managed_by  = "terraform"
  }
}

# --- APIs ---------------------------------------------------------------------
# Enabled explicitly rather than assumed. A deploy into a fresh project fails
# here with a clear message instead of somewhere in the middle of a service
# creation with an opaque PERMISSION_DENIED.

resource "google_project_service" "run" {
  project            = var.project_id
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "artifactregistry" {
  project            = var.project_id
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

# The model. With GOOGLE_CLOUD_PROJECT set (it is, for Firestore), the API
# calls Gemini through Vertex AI, so the project needs it on and the model key
# must be allowed to call it.
resource "google_project_service" "aiplatform" {
  project            = var.project_id
  service            = "aiplatform.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "secretmanager" {
  project            = var.project_id
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

# --- Artifact Registry --------------------------------------------------------

resource "google_artifact_registry_repository" "api" {
  project       = var.project_id
  location      = var.region
  repository_id = "sunny-${local.name_suffix}"
  description   = "Sunny API container images (${var.environment})"
  format        = "DOCKER"
  labels        = local.labels

  depends_on = [google_project_service.artifactregistry]
}

# --- Identity -----------------------------------------------------------------

resource "google_service_account" "api" {
  project      = var.project_id
  account_id   = "sunny-api-${local.name_suffix}"
  display_name = "Sunny API (${var.environment})"
  description  = "Runtime identity for the Sunny API on Cloud Run."
}

# --- Secret -------------------------------------------------------------------
# The secret container is created here; the value is not. Terraform state is
# readable by anyone with access to the bucket, so a credential must never pass
# through it. See README.md for the one command that adds the value.

resource "google_secret_manager_secret" "gemini_api_key" {
  project   = var.project_id
  secret_id = var.gemini_api_key_secret
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_iam_member" "api_reads_key" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.gemini_api_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

# --- Cloud Run ----------------------------------------------------------------
# The API is stateless and holds no conversation data of its own: conversations
# and leads live in the store, which is why the service can scale horizontally
# without coordination. `cpu_idle` is left at its default (true) because a chat
# turn is I/O-bound waiting on the model, not CPU-bound.

resource "google_cloud_run_v2_service" "api" {
  project  = var.project_id
  name     = local.api_name
  location = var.region
  labels   = local.labels

  # Deletions go through the console or a deliberate `terraform destroy`. An
  # accidental delete of a live widget endpoint should take more than one key.
  deletion_protection = var.environment == "prod"

  template {
    service_account = google_service_account.api.email

    scaling {
      min_instance_count = var.api_min_instances
      max_instance_count = var.api_max_instances
    }

    containers {
      image = var.api_image

      ports {
        container_port = 8080
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      # No PORT: Cloud Run reserves it and sets it from container_port (8080).

      env {
        name  = "WIDGET_ALLOWED_ORIGINS"
        value = join(",", var.allowed_origins)
      }

      # Cloud Run's address, not the API's own loopback default.
      env {
        name  = "HOST"
        value = "0.0.0.0"
      }

      # The operational store (firestore.tf). Production refuses to boot without
      # a store named explicitly, so this is not optional.
      env {
        name  = "SUNNY_STORE"
        value = "firestore"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "SUNNY_FIRESTORE_DATABASE"
        value = google_firestore_database.sunny.name
      }

      # Cloud Run's front end is one proxy hop. Without this every visitor
      # shares one rate-limit bucket, keyed on the front end's address (D-10).
      env {
        name  = "SUNNY_TRUST_PROXY"
        value = "1"
      }

      # Installer sign-in verifies Firebase ID tokens for this project.
      env {
        name  = "FIREBASE_PROJECT_ID"
        value = var.firebase_project_id != "" ? var.firebase_project_id : var.project_id
      }

      # Public URLs, for install snippets and links in emails, once known.
      dynamic "env" {
        for_each = merge(
          var.site_url == "" ? {} : {
            SUNNY_DASHBOARD_URL     = var.site_url
            SUNNY_WIDGET_SCRIPT_URL = "${var.site_url}/widget/sunny-widget.js"
          },
          var.api_base_url == "" ? {} : {
            SUNNY_PUBLIC_API_URL = var.api_base_url
          },
          # Stripe price ids are identifiers, not secrets.
          { for plan, id in var.stripe_price_ids : "STRIPE_PRICE_${upper(plan)}" => id },
        )
        content {
          name  = env.key
          value = env.value
        }
      }

      # Billing's two secrets, once their values are in Secret Manager. Until
      # `stripe_enabled` is set they are not referenced: Cloud Run refuses to
      # deploy a revision whose secret has no version yet.
      dynamic "env" {
        for_each = var.stripe_enabled ? {
          STRIPE_SECRET_KEY     = google_secret_manager_secret.stripe_secret_key.secret_id
          STRIPE_WEBHOOK_SECRET = google_secret_manager_secret.stripe_webhook_secret.secret_id
        } : {}
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }

      env {
        name = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.gemini_api_key.secret_id
            version = "latest"
          }
        }
      }

      # A real secret, generated by Terraform and rotated by re-applying. It is
      # random rather than fixed so that no two environments can forge each
      # other's widget sessions.
      env {
        name = "SESSION_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.session_secret.secret_id
            version = "latest"
          }
        }
      }

      # The operator's key for the admin routes (the waitlist, catalogues, the
      # demo seed). Generated per environment, like the session secret; read
      # it with `gcloud secrets versions access latest --secret=<id>`.
      env {
        name = "SUNNY_ADMIN_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.admin_token.secret_id
            version = "latest"
          }
        }
      }

      # SunScan model files go to the private bucket (sunscan.tf): Cloud Run's
      # disk does not outlive an instance. The API reads them back through its
      # tenant-scoped routes; nothing in the bucket is public.
      env {
        name  = "SUNSCAN_ARTEFACT_STORE"
        value = "gcs"
      }
      env {
        name  = "SUNSCAN_ARTEFACT_BUCKET"
        value = google_storage_bucket.sunscan_artefacts.name
      }

      # Assessments through Cloud Tasks once the API's public URL is known
      # (var.api_base_url); until then they run in-process.
      dynamic "env" {
        for_each = var.api_base_url == "" ? {} : {
          SUNSCAN_QUEUE                 = "cloud-tasks"
          SUNSCAN_TASKS_PROJECT         = var.project_id
          SUNSCAN_TASKS_LOCATION        = var.region
          SUNSCAN_TASKS_QUEUE           = google_cloud_tasks_queue.sunscan.name
          SUNSCAN_TASKS_TARGET_URL      = var.api_base_url
          SUNSCAN_TASKS_SERVICE_ACCOUNT = google_service_account.sunscan_tasks.email
        }
        content {
          name  = env.key
          value = env.value
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      # The probe reaches the container directly, so /healthz works here even
      # though it never does from outside (monitoring.tf).
      startup_probe {
        http_get {
          path = "/healthz"
          port = 8080
        }
        initial_delay_seconds = 2
        period_seconds        = 3
        failure_threshold     = 10
      }
    }

    # A streamed chat turn is long-lived by design. This is the ceiling on one
    # turn, not on the request; Cloud Run's own maximum is higher, and the
    # service closes cleanly well before it is reached.
    timeout = "300s"
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    # The image is deployed by CI, and the tag it uses moves. Terraform tracking
    # it would mean every apply reverts a fresh deploy to whatever the variable
    # said at plan time.
    ignore_changes = [template[0].containers[0].image]
  }

  # A revision that starts before its secrets have a value, or before it may
  # read them, fails to deploy: on a first apply, wait for both.
  depends_on = [
    google_project_service.run,
    google_secret_manager_secret_version.session_secret,
    google_secret_manager_secret_version.admin_token,
    google_secret_manager_secret_iam_member.api_reads_key,
    google_secret_manager_secret_iam_member.api_reads_session_secret,
    google_secret_manager_secret_iam_member.api_reads_admin_token,
  ]
}

resource "google_secret_manager_secret" "session_secret" {
  project   = var.project_id
  secret_id = "sunny-session-secret-${local.name_suffix}"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

# Stripe's API key and webhook signing secret: created empty, filled out of
# band like the Gemini key (README.md), never through Terraform state.
resource "google_secret_manager_secret" "stripe_secret_key" {
  project   = var.project_id
  secret_id = "sunny-stripe-secret-key-${local.name_suffix}"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret" "stripe_webhook_secret" {
  project   = var.project_id
  secret_id = "sunny-stripe-webhook-secret-${local.name_suffix}"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_iam_member" "api_reads_stripe" {
  for_each = {
    key     = google_secret_manager_secret.stripe_secret_key.secret_id
    webhook = google_secret_manager_secret.stripe_webhook_secret.secret_id
  }
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "random_password" "session_secret" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret_version" "session_secret" {
  secret      = google_secret_manager_secret.session_secret.id
  secret_data = random_password.session_secret.result
}

resource "google_secret_manager_secret_iam_member" "api_reads_session_secret" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.session_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret" "admin_token" {
  project   = var.project_id
  secret_id = "sunny-admin-token-${local.name_suffix}"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "random_password" "admin_token" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret_version" "admin_token" {
  secret      = google_secret_manager_secret.admin_token.id
  secret_data = random_password.admin_token.result
}

resource "google_secret_manager_secret_iam_member" "api_reads_admin_token" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.admin_token.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

# --- Access -------------------------------------------------------------------
# The widget runs in a customer's browser, so the endpoint has to be reachable
# without an authenticated caller; the session token is what authorises a
# conversation, and it is issued by `/v1/widget/session` only for an origin on
# the allow-list.

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count    = length(var.cloud_run_invoker_members) == 0 ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "explicit_invokers" {
  for_each = toset(var.cloud_run_invoker_members)

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = each.value
}
