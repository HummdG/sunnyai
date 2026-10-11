#!/usr/bin/env sh
#
# Smoke-test a running Sunny deployment. §13's `scripts/smoke-test`.
#
# Three layers, cheapest first, and each one is a different question:
#
#   1. `/healthz` answers, and it says `ok` — the process is up *and* its store
#      is reachable. A 200 with `ok: false` is the failure mode this exists to
#      catch: the API serving requests while its persistence is broken.
#   2. `scripts/smoke-api.mjs` walks the real endpoints and asserts on them. It
#      is the same script CI runs and it owns its own exit code, so this wrapper
#      does not re-implement any of its checks.
#   3. The widget bundle, when `SUNNY_WIDGET_URL` says where it is served from,
#      is fetched and inspected: a bundle that 404s, or that is served as the
#      host page's HTML with a 200, is the failure that a page's own tests would
#      report as a mystery.
#
# Usage:
#   scripts/smoke-test.sh [base-url]
#
# Environment:
#   BASE or SUNNY_API_URL   the API to test, default http://127.0.0.1:8787
#   SUNNY_WIDGET_URL        the widget bundle as a browser fetches it, optional
#   SUNNY_ADMIN_TOKEN       passed through as SMOKE_ADMIN_TOKEN, optional
#   SMOKE_EXPECT_CHAT=1     also require the assistant to answer
#   SUNNY_PUBLIC_ID         the widget id on that deployment, optional
#
# Exit codes: 0 everything checked held, 1 something failed, 2 the script was not
# run (no curl, or an unusable URL). A skipped layer is printed as skipped.

set -eu

. "$(dirname -- "$0")/deploy-lib.sh"

need curl 'It is what this script uses to reach the deployment.'
need node 'The API smoke script is Node, and the repository requires Node 22+.'

base="${1:-${SUNNY_API_URL:-${BASE:-http://127.0.0.1:8787}}}"
base="$(printf '%s' "$base" | sed 's:/*$::')"
case "$base" in
  http://* | https://*) ;;
  *) refuse "'$base' is not an http(s) URL." ;;
esac

say "smoke: $base"
failures=0
skip_note() { say "  skip $1 — $2"; }

# ── 1. health ────────────────────────────────────────────────────────────────

health="$(curl -sS --max-time 15 "$base/healthz" 2>/dev/null || true)"
if [ -z "$health" ]; then
  warn "  FAIL /healthz — no response"
  failures=$((failures + 1))
else
  if health_ok="$(printf '%s' "$health" | json_field ok)" && [ "$health_ok" = "true" ]; then
    kind="$(printf '%s' "$health" | json_field store.kind || printf '?')"
    chat="$(printf '%s' "$health" | json_field capabilities.chat.available || printf '?')"
    say "  ok   /healthz — store=$kind chat=$chat"
  else
    detail="$(printf '%s' "$health" | json_field store.detail || printf '%s' "$health")"
    warn "  FAIL /healthz — the API answered but is not healthy: $detail"
    failures=$((failures + 1))
  fi
fi

# ── 2. the API, endpoint by endpoint ─────────────────────────────────────────

step 'API'
if BASE="$base" \
  SMOKE_EXPECT_CHAT="${SMOKE_EXPECT_CHAT:-}" \
  SMOKE_ADMIN_TOKEN="${SUNNY_ADMIN_TOKEN:-}" \
  SMOKE_PUBLIC_ID="${SUNNY_PUBLIC_ID:-}" \
  SMOKE_ORIGIN="${SUNNY_ORIGIN:-}" \
  node scripts/smoke-api.mjs "$base"; then
  :
else
  warn '  the API smoke script reported failures (its output is above)'
  failures=$((failures + 1))
fi

# ── 3. the widget a page would load ──────────────────────────────────────────

step 'Widget bundle'
if [ -z "${SUNNY_WIDGET_URL:-}" ]; then
  skip_note 'widget bundle' 'SUNNY_WIDGET_URL is not set, so there is nothing to fetch'
else
  # Headers and body into files rather than into one string: a bundle with a
  # newline in it would otherwise be indistinguishable from the status line this
  # script appends after it, and the check below would pass on half a file.
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -sS --max-time 30 -D "$tmp/headers" -o "$tmp/body" "$SUNNY_WIDGET_URL" >/dev/null 2>&1 || true
  status="$(sed -n '1s/^HTTP\/[0-9.]* \([0-9]*\).*/\1/p' "$tmp/headers")"
  content_type="$(sed -n 's/^[Cc]ontent-[Tt]ype: *\([^;]*\).*/\1/p' "$tmp/headers" | tr -d '\r')"
  bytes="$(wc -c <"$tmp/body" | tr -d ' ')"

  if [ "$status" != "200" ]; then
    warn "  FAIL $SUNNY_WIDGET_URL — ${status:-no status} ${content_type:-no content type}"
    failures=$((failures + 1))
  elif ! printf '%s' "$content_type" | grep -q 'javascript'; then
    warn "  FAIL $SUNNY_WIDGET_URL — served as '$content_type', not JavaScript"
    failures=$((failures + 1))
  elif grep -q 'attachShadow' "$tmp/body" && grep -q 'data-sunny-widget' "$tmp/body"; then
    # A 200 serving the host page's HTML is the failure that costs an afternoon:
    # the tag is there, the browser runs nothing, and every test passes except
    # the ones that open the widget. Asking for the two strings the widget's own
    # source contains is what tells the two apart.
    say "  ok   $SUNNY_WIDGET_URL — $bytes bytes, JavaScript, and it is the widget"
  else
    warn "  FAIL $SUNNY_WIDGET_URL — a $bytes-byte JavaScript response that is not the widget bundle"
    failures=$((failures + 1))
  fi
fi

# ── result ───────────────────────────────────────────────────────────────────

printf '\n'
if [ "$failures" -gt 0 ]; then
  die "$failures smoke layer(s) failed against $base"
fi
say "smoke passed against $base"
