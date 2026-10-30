# --- The website and installer dashboard ----------------------------------------
# One Next.js app (apps/marketing): the public site, sign-up and sign-in, and the
# dashboard under /dashboard. ADR-002 chose Firebase App Hosting, but the app is
# on Next 16, which App Hosting does not document support for, so it runs as a
# Cloud Run service beside the API (D-37). The image is built by
# apps/marketing/Dockerfile; its NEXT_PUBLIC_* settings are build arguments
# (the API URL and the Firebase web config), so they are fixed in the image,
# not here.

# Its own identity, with no grants at all: the site reaches data only through
# the API, as a browser would. (Cloud Run pulls same-project images with its own
# service agent, so not even a registry grant is needed.)
resource "google_service_account" "web" {
  project      = var.project_id
  account_id   = "sunny-web-${local.name_suffix}"
  display_name = "Sunny website (${var.environment})"
  description  = "Runtime identity for the Sunny website and dashboard on Cloud Run."
}

resource "google_cloud_run_v2_service" "web" {
  project  = var.project_id
  name     = local.web_name
  location = var.region
  labels   = local.labels

  deletion_protection = var.environment == "prod"

  # Behind the load balancer only, once the site's URL is on the domain (armor.tf).
  ingress = local.web_behind_edge ? "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" : "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.web.email

    scaling {
      min_instance_count = var.web_min_instances
      max_instance_count = var.web_max_instances
    }

    containers {
      image = var.web_image

      ports {
        container_port = 8080
      }

      # Where the site's server-side code calls the API (sign-in sessions, the
      # dashboard's data). The browser-side URL is baked into the image.
      env {
        name  = "SUNNY_API_URL"
        value = var.api_base_url != "" ? var.api_base_url : google_cloud_run_v2_service.api.uri
      }

      # Lets the API's edge policy tell this server's calls from a visitor's
      # (armor.tf). Not a credential: it only skips the per-address count.
      dynamic "env" {
        for_each = local.api_behind_edge ? [1] : []
        content {
          name  = "SUNNY_EDGE_KEY"
          value = random_password.edge_key[0].result
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      startup_probe {
        http_get {
          path = "/"
          port = 8080
        }
        initial_delay_seconds = 2
        period_seconds        = 3
        failure_threshold     = 10
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    # Deployed by CI, like the API (see main.tf).
    ignore_changes = [template[0].containers[0].image]
  }

  depends_on = [google_project_service.run]
}

# A public website.
resource "google_cloud_run_v2_service_iam_member" "web_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.web.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
