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

variable "gemini_surface" {
  description = <<-EOT
    How the API reaches the model. "vertex" (the default): Vertex AI, called as
    the API's own service account and billed to this project's account, with no
    key. "developer-api": the Gemini API, with the key in Secret Manager, which
    on a new account needs prepaid credit.
  EOT
  type        = string
  default     = "vertex"

  validation {
    condition     = contains(["developer-api", "vertex"], var.gemini_surface)
    error_message = "gemini_surface must be \"developer-api\" or \"vertex\"."
  }
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

variable "web_image" {
  description = <<-EOT
    Container image for the website and dashboard (apps/marketing/Dockerfile),
    including a tag or digest. No default, for the same reason as api_image.
  EOT
  type        = string
}

variable "web_min_instances" {
  description = "Minimum Cloud Run instances for the website. 0 scales to zero."
  type        = number
  default     = 0
}

variable "web_max_instances" {
  description = "Ceiling on Cloud Run instances for the website."
  type        = number
  default     = 4
}

variable "firestore_location" {
  description = <<-EOT
    Where the Firestore database lives. Fixed once created: Firestore cannot move
    a database. London by default, beside the services and inside the UK.
  EOT
  type        = string
  default     = "europe-west2"
}

variable "site_url" {
  description = <<-EOT
    The website's public URL with no trailing slash (https://heysunny.co.uk, or the
    Cloud Run URL from a first apply). Used for the dashboard links and the
    widget script URL in installers' install snippets. Empty leaves the API's
    development defaults, which are wrong in production -- set it.
  EOT
  type        = string
  default     = ""
}

variable "firebase_project_id" {
  description = "Firebase project whose ID tokens the API accepts. Empty means this GCP project."
  type        = string
  default     = ""
}

variable "stripe_enabled" {
  description = <<-EOT
    Inject the Stripe secrets into the API. Set to true only after both secrets
    have a value in Secret Manager (README.md), or the deploy fails.
  EOT
  type        = bool
  default     = false
}

variable "stripe_price_ids" {
  description = <<-EOT
    Stripe price ids per package, keyed base, email, voice and suite: monthly
    recurring prices in GBP, excluding VAT, matching apps/marketing/app/site.ts.
  EOT
  type        = map(string)
  default     = {}

  validation {
    condition     = alltrue([for k in keys(var.stripe_price_ids) : contains(["base", "email", "voice", "suite"], k)])
    error_message = "stripe_price_ids keys must be base, email, voice or suite."
  }
}

variable "alert_email" {
  description = "Where uptime alerts go (monitoring.tf). Empty means checks run but nobody is told."
  type        = string
  default     = ""
}

variable "google_oauth_client_id" {
  description = "The Google OAuth client id for connecting an installer's Gmail (email.tf). An identifier, not a secret."
  type        = string
  default     = ""
}

variable "gmail_enabled" {
  description = <<-EOT
    Mount the Gmail settings into the API (email.tf). Set to true only once the
    OAuth client secret has a value in Secret Manager, or the deploy fails.
  EOT
  type        = bool
  default     = false

  validation {
    condition     = !var.gmail_enabled || var.google_oauth_client_id != ""
    error_message = "gmail_enabled needs google_oauth_client_id."
  }
}

variable "web_domains" {
  description = <<-EOT
    Hostnames the website answers on, main one first (e.g. ["heysunny.co.uk"]).
    Empty (the default) creates no load balancer, and the environment stays on
    its run.app URLs. See domain.tf.
  EOT
  type        = list(string)
  default     = []
}

variable "web_redirect_domains" {
  description = "Hostnames redirected to the first of web_domains, e.g. [\"www.heysunny.co.uk\"]."
  type        = list(string)
  default     = []
}

variable "api_domains" {
  description = <<-EOT
    Hostnames the API answers on (e.g. ["api.heysunny.co.uk"]). Used only when
    web_domains is set. Set api_base_url to match, or the widget and the email
    links keep pointing at the run.app URL.
  EOT
  type        = list(string)
  default     = []
}

variable "api_env" {
  description = "Extra plain environment variables for the API, such as GEMINI_MODEL or the SUNNY_RL_* rate limits. Not for secrets."
  type        = map(string)
  default     = {}
}
