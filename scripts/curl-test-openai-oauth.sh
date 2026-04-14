#!/usr/bin/env bash
# =============================================================================
# curl-test-openai-oauth.sh
#
# Reads credentials from ~/.codex/auth.json and fires a streaming curl request
# directly to the upstream chatgpt.com Codex endpoint — the same URL, headers,
# and body that the openai-oauth library uses internally.
#
# Usage:
#   chmod +x scripts/curl-test-openai-oauth.sh
#   ./scripts/curl-test-openai-oauth.sh
#
# Optional env vars:
#   CODEX_HOME   – override the auth.json directory (default: ~/.codex)
#   MODEL        – Codex model to use            (default: gpt-5.4)
#   PORT         – local API server port         (default: 23333)
#   PROMPT       – message to send               (default: hardcoded)
# =============================================================================

set -euo pipefail

AUTH_DIR="${CODEX_HOME:-$HOME/.codex}"
AUTH_FILE="$AUTH_DIR/auth.json"
MODEL="${MODEL:-gpt-5.4}"
PORT="${PORT:-23333}"
PROMPT="${PROMPT:-Say "OpenAI OAuth curl test working!" and nothing else.}"

# ── 1. Validate auth file ───────────────────────────────────────────────────
if [[ ! -f "$AUTH_FILE" ]]; then
  echo "ERROR: auth.json not found at $AUTH_FILE"
  echo "  Run: codex login"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required (brew install jq)"
  exit 1
fi

ACCESS_TOKEN=$(jq -r '.tokens.access_token // empty' "$AUTH_FILE")
ACCOUNT_ID=$(jq -r '.tokens.account_id // empty' "$AUTH_FILE")

if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "ERROR: access_token missing from $AUTH_FILE"
  echo "  Run: codex login"
  exit 1
fi

if [[ -z "$ACCOUNT_ID" ]]; then
  # Fall back: derive account_id from the id_token JWT payload
  ID_TOKEN=$(jq -r '.tokens.id_token // empty' "$AUTH_FILE")
  if [[ -n "$ID_TOKEN" ]]; then
    # Base64-decode the JWT payload (second segment)
    PAYLOAD=$(echo "$ID_TOKEN" | cut -d. -f2 | tr -- '-_' '+/' | \
              awk '{ pad=4-length($0)%4; if(pad<4) for(i=0;i<pad;i++) $0=$0"=" }1' | \
              base64 --decode 2>/dev/null || true)
    ACCOUNT_ID=$(echo "$PAYLOAD" | jq -r '.chatgpt_account_id // empty' 2>/dev/null || true)
  fi
fi

if [[ -z "$ACCOUNT_ID" ]]; then
  echo "ERROR: account_id could not be resolved from $AUTH_FILE"
  exit 1
fi

echo "Auth file   : $AUTH_FILE"
echo "access_token: ${ACCESS_TOKEN:0:12}…  (${#ACCESS_TOKEN} chars)"
echo "account_id  : $ACCOUNT_ID"
echo ""

# ── 2. Build request bodies ─────────────────────────────────────────────────
#
# chatgpt.com uses the Responses API format, NOT Chat Completions format:
#   - `input`        instead of `messages`
#   - `instructions` is required (cannot be empty)
#   - `store: false` skips server-side history
#
# The openai-oauth library converts /v1/chat/completions → Responses format
# automatically. When calling chatgpt.com directly we must use Responses format.
RESPONSES_BODY=$(jq -n \
  --arg model "$MODEL" \
  --arg prompt "$PROMPT" \
  '{
    model:        $model,
    stream:       true,
    instructions: "You are a helpful assistant.",
    input:        [{ role: "user", content: $prompt }],
    store:        false
  }')

# Chat Completions format used by the local proxy and openai-oauth library
CHAT_BODY=$(jq -n \
  --arg model "$MODEL" \
  --arg prompt "$PROMPT" \
  '{
    model:    $model,
    stream:   true,
    messages: [{ role: "user", content: $prompt }]
  }')

# ─────────────────────────────────────────────────────────────────────────────
# TEST A: Direct to chatgpt.com (bypasses local proxy entirely)
#         URL:     https://chatgpt.com/backend-api/codex/responses
#         Headers: Authorization, chatgpt-account-id, OpenAI-Beta
# ─────────────────────────────────────────────────────────────────────────────
echo "══════════════════════════════════════════════════════════════"
echo "TEST A — Direct to chatgpt.com/backend-api/codex/responses"
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "curl command:"
cat <<CMD
curl -N -X POST "https://chatgpt.com/backend-api/codex/responses" \\
  -H "Authorization: Bearer ${ACCESS_TOKEN:0:12}…" \\
  -H "chatgpt-account-id: $ACCOUNT_ID" \\
  -H "OpenAI-Beta: responses=experimental" \\
  -H "Content-Type: application/json" \\
  -d '$RESPONSES_BODY'
CMD
echo ""
echo "Running…"
echo "──────────────────────────────────────────────────────────────"

HTTP_STATUS=$(curl -s -o /tmp/openai-oauth-test-direct.txt -w "%{http_code}" \
  -N -X POST "https://chatgpt.com/backend-api/codex/responses" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "chatgpt-account-id: $ACCOUNT_ID" \
  -H "OpenAI-Beta: responses=experimental" \
  -H "Content-Type: application/json" \
  -d "$RESPONSES_BODY") || true

echo "HTTP status: $HTTP_STATUS"
if [[ "$HTTP_STATUS" == "200" ]]; then
  # Responses API SSE events: look for output_text.delta or output[].content[].text
  grep '^data:' /tmp/openai-oauth-test-direct.txt | grep -v '\[DONE\]' | \
    jq -r 'try (.delta // .output[0].content[0].text // empty)' 2>/dev/null \
    | tr -d '\n' || cat /tmp/openai-oauth-test-direct.txt
  echo ""
  echo ""
  echo "✓ TEST A PASSED"
else
  cat /tmp/openai-oauth-test-direct.txt
  echo ""
  echo "✗ TEST A FAILED (HTTP $HTTP_STATUS)"
fi

echo ""

# ─────────────────────────────────────────────────────────────────────────────
# TEST B: Through the local API server public route (/v1/chat/completions)
#         Requires: the API Bearer token from app Settings → API Server
# ─────────────────────────────────────────────────────────────────────────────
echo "══════════════════════════════════════════════════════════════"
echo "TEST B — Local API server: POST /v1/chat/completions"
echo "          Model format: openai:<model>  (provider:model)"
echo "══════════════════════════════════════════════════════════════"
echo ""

LOCAL_API_KEY="${LOCAL_API_KEY:-}"
if [[ -z "$LOCAL_API_KEY" ]]; then
  echo "  ⚠  Skipping — set LOCAL_API_KEY env var to your API server key"
  echo "     (find it in app Settings → API Server → API Key)"
  echo ""
  echo "  Example:"
  echo "    LOCAL_API_KEY=your-key ./scripts/curl-test-openai-oauth.sh"
else
  # Local proxy uses Chat Completions format with prefixed model name
  LOCAL_BODY=$(jq -n \
    --arg model "openai:$MODEL" \
    --arg prompt "$PROMPT" \
    '{
      model:    $model,
      stream:   true,
      messages: [{ role: "user", content: $prompt }]
    }')

  echo "curl command:"
  cat <<CMD
curl -N -X POST "http://127.0.0.1:$PORT/v1/chat/completions" \\
  -H "Authorization: Bearer ${LOCAL_API_KEY:0:8}…" \\
  -H "Content-Type: application/json" \\
  -d '$LOCAL_BODY'
CMD
  echo ""
  echo "Running…"
  echo "──────────────────────────────────────────────────────────────"

  HTTP_STATUS=$(curl -s -o /tmp/openai-oauth-test-local.txt -w "%{http_code}" \
    -N -X POST "http://127.0.0.1:$PORT/v1/chat/completions" \
    -H "Authorization: Bearer $LOCAL_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$LOCAL_BODY") || true

  echo "HTTP status: $HTTP_STATUS"
  if [[ "$HTTP_STATUS" == "200" ]]; then
    grep '^data:' /tmp/openai-oauth-test-local.txt | \
      grep -v '\[DONE\]' | \
      jq -r '.choices[0].delta.content // empty' 2>/dev/null \
      | tr -d '\n' || cat /tmp/openai-oauth-test-local.txt
    echo ""
    echo ""
    echo "✓ TEST B PASSED"
  else
    cat /tmp/openai-oauth-test-local.txt
    echo ""
    echo "✗ TEST B FAILED (HTTP $HTTP_STATUS)"
  fi
fi

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "Extracted header values for manual curl:"
echo ""
echo "  Authorization: Bearer $ACCESS_TOKEN"
echo "  chatgpt-account-id: $ACCOUNT_ID"
echo "  OpenAI-Beta: responses=experimental"
echo "══════════════════════════════════════════════════════════════"
