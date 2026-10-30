# --- Edge rate limiting (Cloud Armor) --------------------------------------------
# A Cloud Armor policy on each of the load balancer's backends (domain.tf),
# counting requests per client address before they reach Cloud Run:
#
#   * over `edge_rate_limits.<backend>_per_minute` from one address, the excess
#     is answered 429 at the edge, without waking an instance;
#   * over five times that, the address is banned for ten minutes.
#
# The thresholds sit well above anything a person does, so they only catch
# scripts and floods. The API's own limiter (apps/api/src/ratelimit.ts) still
# applies the per-route limits behind this.
#
# Two things make the edge mean something:
#
#   * Cloud Run accepts traffic only from the load balancer once the
#     environment's URLs are on the domain, so the run.app addresses cannot be
#     used to go around the policy.
#   * The website's server calls the API on behalf of every signed-in installer,
#     all from Cloud Run's few outgoing addresses. It sends a key
#     (`SUNNY_EDGE_KEY`, header `x-sunny-edge-key`) that the API policy lets
#     through before counting.

locals {
  # Locked to the load balancer only once the environment's public URLs use
  # the domain: before that, callers (the website's server, Cloud Tasks, Gmail
  # push) still use the run.app address and would be refused.
  api_behind_edge = local.domain_enabled && contains([for d in var.api_domains : "https://${d}"], var.api_base_url)
  web_behind_edge = local.domain_enabled && contains([for d in var.web_domains : "https://${d}"], var.site_url)

  edge_key_header = "x-sunny-edge-key"
}

resource "random_password" "edge_key" {
  count   = local.api_behind_edge ? 1 : 0
  length  = 40
  special = false
}

resource "google_compute_security_policy" "api" {
  count       = local.domain_enabled && length(var.api_domains) > 0 ? 1 : 0
  project     = var.project_id
  name        = "sunny-api-edge-${local.name_suffix}"
  description = "Per-address rate limit in front of the Sunny API (${var.environment})."
  type        = "CLOUD_ARMOR"

  dynamic "rule" {
    for_each = local.api_behind_edge ? [1] : []
    content {
      priority    = 1000
      action      = "allow"
      description = "The website's own server, calling for signed-in installers."
      match {
        expr {
          expression = "request.headers['${local.edge_key_header}'] == '${random_password.edge_key[0].result}'"
        }
      }
    }
  }

  rule {
    priority    = 2000
    action      = "rate_based_ban"
    description = "Per address: 429 over the limit, a ten-minute ban over five times it."
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      enforce_on_key = "IP"
      conform_action = "allow"
      exceed_action  = "deny(429)"
      rate_limit_threshold {
        count        = var.edge_rate_limits.api_per_minute
        interval_sec = 60
      }
      ban_threshold {
        count        = var.edge_rate_limits.api_per_minute * 5
        interval_sec = 60
      }
      ban_duration_sec = 600
    }
  }

  rule {
    priority    = 2147483647
    action      = "allow"
    description = "Everything else."
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }

  depends_on = [google_project_service.compute]
}

resource "google_compute_security_policy" "web" {
  count       = local.domain_enabled ? 1 : 0
  project     = var.project_id
  name        = "sunny-web-edge-${local.name_suffix}"
  description = "Per-address rate limit in front of the Sunny website (${var.environment})."
  type        = "CLOUD_ARMOR"

  rule {
    priority    = 2000
    action      = "rate_based_ban"
    description = "Per address: 429 over the limit, a ten-minute ban over five times it."
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      enforce_on_key = "IP"
      conform_action = "allow"
      exceed_action  = "deny(429)"
      rate_limit_threshold {
        count        = var.edge_rate_limits.web_per_minute
        interval_sec = 60
      }
      ban_threshold {
        count        = var.edge_rate_limits.web_per_minute * 5
        interval_sec = 60
      }
      ban_duration_sec = 600
    }
  }

  rule {
    priority    = 2147483647
    action      = "allow"
    description = "Everything else."
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }

  depends_on = [google_project_service.compute]
}
