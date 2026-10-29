# --- Custom domain -------------------------------------------------------------
# One global external HTTPS load balancer per environment, in front of the two
# Cloud Run services: the website's hostnames go to the website, the API's to the
# API, and a Google-managed certificate covers all of them.
#
# A load balancer rather than Cloud Run domain mappings, for two reasons. Domain
# mappings are not offered in europe-west2, where the services run. And the load
# balancer is where Cloud Armor attaches, which is the edge rate limiting the
# in-process limiter (apps/api/src/ratelimit.ts) says it is not a substitute for.
#
# Nothing here is created until `web_domains` names at least one hostname, so an
# environment without a domain keeps serving on its run.app URLs and costs
# nothing extra. The run.app URLs keep working after the domain is on.
#
# After the first apply, point an A record for every hostname at the
# `edge_ip_address` output. The certificate stays PROVISIONING until DNS
# resolves to that address, which usually takes 15 to 60 minutes.

locals {
  domain_enabled = length(var.web_domains) > 0
  # The website's main hostname, which the redirect hostnames send visitors to.
  primary_web_domain = local.domain_enabled ? var.web_domains[0] : ""
  all_domains        = concat(var.web_domains, var.web_redirect_domains, var.api_domains)
}

resource "google_project_service" "compute" {
  count              = local.domain_enabled ? 1 : 0
  project            = var.project_id
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

resource "google_compute_global_address" "edge" {
  count   = local.domain_enabled ? 1 : 0
  project = var.project_id
  name    = "sunny-edge-${local.name_suffix}"
  labels  = local.labels

  depends_on = [google_project_service.compute]
}

resource "google_compute_region_network_endpoint_group" "web" {
  count                 = local.domain_enabled ? 1 : 0
  project               = var.project_id
  name                  = "sunny-web-neg-${local.name_suffix}"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.web.name
  }

  depends_on = [google_project_service.compute]
}

resource "google_compute_region_network_endpoint_group" "api" {
  count                 = local.domain_enabled && length(var.api_domains) > 0 ? 1 : 0
  project               = var.project_id
  name                  = "sunny-api-neg-${local.name_suffix}"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.api.name
  }

  depends_on = [google_project_service.compute]
}

resource "google_compute_backend_service" "web" {
  count                 = local.domain_enabled ? 1 : 0
  project               = var.project_id
  name                  = "sunny-web-backend-${local.name_suffix}"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"

  backend {
    group = google_compute_region_network_endpoint_group.web[0].id
  }
}

resource "google_compute_backend_service" "api" {
  count                 = local.domain_enabled && length(var.api_domains) > 0 ? 1 : 0
  project               = var.project_id
  name                  = "sunny-api-backend-${local.name_suffix}"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"
  # No timeout_sec: a serverless backend refuses one, and Cloud Run's own
  # request timeout is what bounds a streamed (SSE) chat answer.

  backend {
    group = google_compute_region_network_endpoint_group.api[0].id
  }
}

resource "google_compute_managed_ssl_certificate" "edge" {
  count   = local.domain_enabled ? 1 : 0
  project = var.project_id
  # The name carries a hash of the hostnames: a managed certificate cannot be
  # edited, so a changed list is a new certificate, created before the old one
  # is removed so the site never goes without one.
  name = "sunny-cert-${local.name_suffix}-${substr(sha256(join(",", local.all_domains)), 0, 8)}"

  managed {
    domains = local.all_domains
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [google_project_service.compute]
}

resource "google_compute_url_map" "edge" {
  count           = local.domain_enabled ? 1 : 0
  project         = var.project_id
  name            = "sunny-edge-${local.name_suffix}"
  default_service = google_compute_backend_service.web[0].id

  dynamic "host_rule" {
    for_each = length(var.api_domains) > 0 ? [1] : []
    content {
      hosts        = var.api_domains
      path_matcher = "api"
    }
  }

  dynamic "path_matcher" {
    for_each = length(var.api_domains) > 0 ? [1] : []
    content {
      name            = "api"
      default_service = google_compute_backend_service.api[0].id
    }
  }

  dynamic "host_rule" {
    for_each = length(var.web_redirect_domains) > 0 ? [1] : []
    content {
      hosts        = var.web_redirect_domains
      path_matcher = "to-primary"
    }
  }

  dynamic "path_matcher" {
    for_each = length(var.web_redirect_domains) > 0 ? [1] : []
    content {
      name = "to-primary"
      default_url_redirect {
        host_redirect          = local.primary_web_domain
        https_redirect         = true
        redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
        strip_query            = false
      }
    }
  }
}

resource "google_compute_target_https_proxy" "edge" {
  count            = local.domain_enabled ? 1 : 0
  project          = var.project_id
  name             = "sunny-https-${local.name_suffix}"
  url_map          = google_compute_url_map.edge[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.edge[0].id]
}

resource "google_compute_global_forwarding_rule" "https" {
  count                 = local.domain_enabled ? 1 : 0
  project               = var.project_id
  name                  = "sunny-https-${local.name_suffix}"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.edge[0].id
  port_range            = "443"
  target                = google_compute_target_https_proxy.edge[0].id
  labels                = local.labels
}

# Plain http:// on the same address, answered with a redirect to https://.
resource "google_compute_url_map" "http_redirect" {
  count   = local.domain_enabled ? 1 : 0
  project = var.project_id
  name    = "sunny-http-redirect-${local.name_suffix}"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "http_redirect" {
  count   = local.domain_enabled ? 1 : 0
  project = var.project_id
  name    = "sunny-http-${local.name_suffix}"
  url_map = google_compute_url_map.http_redirect[0].id
}

resource "google_compute_global_forwarding_rule" "http" {
  count                 = local.domain_enabled ? 1 : 0
  project               = var.project_id
  name                  = "sunny-http-${local.name_suffix}"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.edge[0].id
  port_range            = "80"
  target                = google_compute_target_http_proxy.http_redirect[0].id
  labels                = local.labels
}
