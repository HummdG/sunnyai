# --- Account emails from the company mailbox -----------------------------------
# Verify-your-email, password reset, sign-in links and email changes are sent
# by the API itself (apps/api/src/auth/account-email.ts), so their links land
# on the website rather than on <project>.firebaseapp.com.
#
# The API asks Firebase Auth for the link only (accounts:sendOobCode with
# returnOobLink), which needs Firebase Authentication Admin. It then sends
# through the Gmail API as a Workspace user by domain-wide delegation: it signs
# the delegation JWT with its own identity through the IAM Credentials API, so
# no key exists. The Workspace side (Admin console > Security > API controls >
# Domain-wide delegation: this service account's client ID, scope
# https://www.googleapis.com/auth/gmail.send) is granted by hand, once
# (docs/integration/account-email.md).
#
# Switched on per environment by setting SUNNY_ACCOUNT_MAIL_SERVICE_ACCOUNT,
# SUNNY_ACCOUNT_MAIL_MAILBOX and SUNNY_ACCOUNT_MAIL_FROM in `api_env`.

resource "google_project_service" "iamcredentials" {
  project            = var.project_id
  service            = "iamcredentials.googleapis.com"
  disable_on_destroy = false
}

# Generate action links (and nothing else it needs from Firebase Auth admin).
resource "google_project_iam_member" "api_generates_auth_links" {
  project = var.project_id
  role    = "roles/firebaseauth.admin"
  member  = "serviceAccount:${google_service_account.api.email}"
}

# Sign its own delegation JWT (signJwt on itself, not on any other account).
resource "google_service_account_iam_member" "api_signs_own_jwt" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.api.email}"
}
