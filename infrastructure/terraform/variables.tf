variable "project_id" {
  description = "GCP project to deploy into. Nothing is created until this is a real project."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run, Artifact Registry and the service account."
  type        = string
  default     = "europe-west2"
}

variable "environment" {
  description = "Environment name, used in resource names and labels."
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be staging or prod."
  }
}

variable "api_image" {
  description = <<-EOT
    Container image for the API, including a tag or digest. There is no default:
    a deployment should always name the exact artifact it is running, so that a
    rollback is a change to this value rather than a rebuild.
  EOT
  type        = string
}

variable "api_min_instances" {
  description = <<-EOT
    Minimum Cloud Run instances. 0 means scale to zero, which is cheap but adds a
    cold start to the first visitor's chat turn. Raise it once traffic justifies
    the cost.
  EOT
  type        = number
  default     = 0
}

variable "api_max_instances" {
  description = "Ceiling on Cloud Run instances. The limit that protects the budget."
  type        = number
  default     = 4
}

variable "allowed_origins" {
  description = <<-EOT
    Origins permitted to open a widget session. Empty is a configuration error in
    production: the API refuses to boot without it, so this has no permissive
    default.
  EOT
  type        = list(string)
  default     = []
}

variable "gemini_api_key_secret" {
  description = <<-EOT
    Secret Manager secret id holding the model credential. The secret is created
    empty: its value is added out of band, never through Terraform state.
  EOT
  type        = string
  default     = "sunny-gemini-api-key"
}

variable "cloud_run_invoker_members" {
  description = <<-EOT
    Identities allowed to invoke the API directly. Empty means the service is
    public, which is the intended posture for a widget endpoint that customers'
    browsers call. Listed here so the choice is explicit and reviewable rather
    than an implicit default.
  EOT
  type        = list(string)
  default     = []
}

variable "api_base_url" {
  description = <<-EOT
    The API's public base URL (its custom domain, or the Cloud Run URL from a
    first apply). When set, SunScan assessments run through Cloud Tasks, which
    calls back to <api_base_url>/internal/sunscan/run; empty keeps them
    in-process. A variable rather than the service's own `uri` because a
    service cannot reference its own URL in its definition.
  EOT
  type        = string
  default     = ""
}
