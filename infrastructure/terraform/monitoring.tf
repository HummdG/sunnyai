# --- Monitoring: someone hears about it when Sunny stops working ------------------
# The API reports what it can do at /health, and until now nothing read it, so a
# revoked or exhausted model key was a silent failure: the widget would refuse
# every chat while every request still answered 200. Three uptime checks, each
# with an alert:
#
#   api-up     /health answers with "ok": true
#   chat-on    /health reports chat.available: true -- the dead-key alarm
#   web-up     the website's home page answers
#
# Not /healthz: Cloud Run's front end answers any path ending in "z" itself,
# so from outside it is always Google's 404.
#
# Alerts go to `alert_email`. With it empty the checks still run and show in the
# console, but nobody is notified -- set it before launch.

resource "google_project_service" "monitoring" {
  project            = var.project_id
  service            = "monitoring.googleapis.com"
  disable_on_destroy = false
}

locals {
  api_host = trimprefix(google_cloud_run_v2_service.api.uri, "https://")
  web_host = trimprefix(google_cloud_run_v2_service.web.uri, "https://")
}

resource "google_monitoring_notification_channel" "email" {
  count        = var.alert_email == "" ? 0 : 1
  project      = var.project_id
  display_name = "Sunny alerts (${var.environment})"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }

  depends_on = [google_project_service.monitoring]
}

resource "google_monitoring_uptime_check_config" "api_up" {
  project      = var.project_id
  display_name = "sunny-${local.name_suffix} api-up"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = "/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = local.api_host
    }
  }

  content_matchers {
    matcher = "MATCHES_JSON_PATH"
    content = "true"
    json_path_matcher {
      json_path    = "$.ok"
      json_matcher = "EXACT_MATCH"
    }
  }

  depends_on = [google_project_service.monitoring]
}

resource "google_monitoring_uptime_check_config" "chat_on" {
  project      = var.project_id
  display_name = "sunny-${local.name_suffix} chat-on"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path         = "/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = local.api_host
    }
  }

  content_matchers {
    matcher = "MATCHES_JSON_PATH"
    content = "true"
    json_path_matcher {
      json_path    = "$.capabilities.chat.available"
      json_matcher = "EXACT_MATCH"
    }
  }

  depends_on = [google_project_service.monitoring]
}

resource "google_monitoring_uptime_check_config" "web_up" {
  project      = var.project_id
  display_name = "sunny-${local.name_suffix} web-up"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = "/"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = local.web_host
    }
  }

  depends_on = [google_project_service.monitoring]
}

locals {
  uptime_alerts = {
    api_up = {
      check   = google_monitoring_uptime_check_config.api_up.uptime_check_id
      summary = "The Sunny API is not answering /health. The widget cannot open a chat."
    }
    chat_on = {
      check   = google_monitoring_uptime_check_config.chat_on.uptime_check_id
      summary = "The Sunny API is up but reports chat unavailable: check the Gemini key in Secret Manager and the model's quota."
    }
    web_up = {
      check   = google_monitoring_uptime_check_config.web_up.uptime_check_id
      summary = "The Sunny website is not answering. Installers cannot sign in to the dashboard."
    }
  }
}

resource "google_monitoring_alert_policy" "uptime" {
  for_each = local.uptime_alerts

  project      = var.project_id
  display_name = "sunny-${local.name_suffix} ${each.key} failing"
  combiner     = "OR"

  conditions {
    display_name = "${each.key} uptime check failing"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.\"check_id\"=\"${each.value.check}\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      aggregations {
        alignment_period     = "1200s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.*"]
      }
      trigger {
        count = 1
      }
    }
  }

  documentation {
    content   = each.value.summary
    mime_type = "text/markdown"
  }

  notification_channels = google_monitoring_notification_channel.email[*].id

  depends_on = [google_project_service.monitoring]
}
