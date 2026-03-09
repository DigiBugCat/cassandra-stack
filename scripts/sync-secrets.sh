#!/usr/bin/env bash
# Sync secrets from env/ files to k8s and/or wrangler
# Usage:
#   ./scripts/sync-secrets.sh              # list all secrets (dry run)
#   ./scripts/sync-secrets.sh apply        # apply all k8s secrets
#   ./scripts/sync-secrets.sh apply <svc>  # apply k8s secrets for one service
#   ./scripts/sync-secrets.sh wrangler <svc>  # push wrangler secrets for one service

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_DIR="$ROOT_DIR/env"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Load an env file and export its KEY=VALUE pairs (skipping comments/blanks/exports)
load_env() {
  local file="$ENV_DIR/$1"
  if [[ ! -f "$file" ]]; then
    echo -e "${RED}Missing env file: $file${NC}" >&2
    return 1
  fi
  while IFS='=' read -r key value; do
    # Skip comments, blank lines
    [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
    # Strip leading 'export '
    key="${key#export }"
    key="$(echo "$key" | xargs)"
    value="$(echo "$value" | sed 's/^"//' | sed 's/"$//')"
    export "$key=$value"
  done < "$file"
}

# Create/update a k8s secret
apply_k8s_secret() {
  local namespace="$1"
  local secret_name="$2"
  shift 2
  local args=()

  while [[ $# -gt 0 ]]; do
    local k8s_key="$1"
    local env_var="$2"
    local val="${!env_var:-}"
    if [[ -z "$val" ]]; then
      echo -e "  ${YELLOW}WARN: $env_var is empty${NC}"
    fi
    args+=("--from-literal=$k8s_key=$val")
    shift 2
  done

  echo -e "  ${GREEN}kubectl create secret generic $secret_name -n $namespace${NC}"
  kubectl create secret generic "$secret_name" \
    --namespace "$namespace" \
    "${args[@]}" \
    --dry-run=client -o yaml | kubectl apply -f -
}

# Push wrangler secrets
apply_wrangler_secrets() {
  local directory="$1"
  shift
  local wrangler_dir="$ROOT_DIR/$directory"

  if [[ ! -d "$wrangler_dir" ]]; then
    echo -e "${RED}Missing wrangler directory: $wrangler_dir${NC}" >&2
    return 1
  fi

  while [[ $# -gt 0 ]]; do
    local key="$1"
    local val="${!key:-}"
    if [[ -z "$val" ]]; then
      echo -e "  ${YELLOW}SKIP: $key is empty${NC}"
      shift
      continue
    fi
    echo -e "  ${GREEN}wrangler secret put $key${NC}"
    echo "$val" | (cd "$wrangler_dir" && npx wrangler secret put "$key")
    shift
  done
}

# ── List mode (dry run) ──
list_secrets() {
  echo -e "${CYAN}=== Secrets Registry ===${NC}\n"

  echo -e "${CYAN}claude-runner${NC} (namespace: claude-runner)"
  echo "  k8s/admin-key: ADMIN_API_KEY"
  echo "  k8s/claude-tokens: CLAUDE_CODE_OAUTH_TOKEN"
  echo "  k8s/git-tokens: GITHUB_TOKEN"
  echo "  k8s/obsidian-auth: OBSIDIAN_AUTH_TOKEN, OBSIDIAN_E2EE_PASSWORD"
  echo "  k8s/cloudflare-tunnel: token"
  echo ""

  echo -e "${CYAN}claude-runner-dev${NC} (namespace: claude-runner-dev)"
  echo "  k8s/claude-tokens: CLAUDE_CODE_OAUTH_TOKEN"
  echo "  k8s/git-tokens: GITHUB_TOKEN"
  echo ""

  echo -e "${CYAN}cassandra-yt-mcp${NC} (namespace: cassandra-yt-mcp)"
  echo "  k8s/cassandra-yt-mcp-backend: BACKEND_API_TOKEN, HUGGINGFACE_TOKEN"
  echo "  k8s/cloudflare-tunnel: token"
  echo "  wrangler: WORKOS_CLIENT_ID, WORKOS_CLIENT_SECRET, COOKIE_ENCRYPTION_KEY,"
  echo "            BACKEND_BASE_URL, BACKEND_API_TOKEN, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET"
  echo ""

  echo -e "${CYAN}terraform${NC} (source env/infra.env before tofu apply)"
  echo "  TF_VAR_cloudflare_api_key, TF_VAR_cloudflare_email, TF_VAR_cloudflare_account_id,"
  echo "  TF_VAR_zone_id, TF_VAR_tunnel_secret, TF_VAR_runner_admin_key,"
  echo "  AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY"
}

# ── Apply k8s secrets ──
apply_service() {
  local svc="$1"

  case "$svc" in
    claude-runner)
      load_env k8s.env
      echo -e "${CYAN}Applying claude-runner secrets...${NC}"
      apply_k8s_secret claude-runner admin-key \
        ADMIN_API_KEY ADMIN_API_KEY
      apply_k8s_secret claude-runner claude-tokens \
        CLAUDE_CODE_OAUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN
      apply_k8s_secret claude-runner git-tokens \
        GITHUB_TOKEN GITHUB_TOKEN
      apply_k8s_secret claude-runner obsidian-auth \
        OBSIDIAN_AUTH_TOKEN OBSIDIAN_AUTH_TOKEN \
        OBSIDIAN_E2EE_PASSWORD OBSIDIAN_E2EE_PASSWORD
      apply_k8s_secret claude-runner cloudflare-tunnel \
        token CLOUDFLARE_TUNNEL_TOKEN
      ;;
    claude-runner-dev)
      load_env k8s.env
      echo -e "${CYAN}Applying claude-runner-dev secrets...${NC}"
      apply_k8s_secret claude-runner-dev claude-tokens \
        CLAUDE_CODE_OAUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN
      apply_k8s_secret claude-runner-dev git-tokens \
        GITHUB_TOKEN GITHUB_TOKEN
      ;;
    cassandra-yt-mcp)
      load_env yt-mcp.env
      echo -e "${CYAN}Applying cassandra-yt-mcp secrets...${NC}"
      apply_k8s_secret cassandra-yt-mcp cassandra-yt-mcp-backend \
        BACKEND_API_TOKEN BACKEND_API_TOKEN \
        HUGGINGFACE_TOKEN HUGGINGFACE_TOKEN
      apply_k8s_secret cassandra-yt-mcp cloudflare-tunnel \
        token YT_MCP_CLOUDFLARE_TUNNEL_TOKEN
      ;;
    all)
      apply_service claude-runner
      apply_service claude-runner-dev
      apply_service cassandra-yt-mcp
      ;;
    *)
      echo -e "${RED}Unknown service: $svc${NC}"
      echo "Available: claude-runner, claude-runner-dev, cassandra-yt-mcp, all"
      exit 1
      ;;
  esac
}

# ── Main ──
case "${1:-}" in
  apply)
    apply_service "${2:-all}"
    ;;
  wrangler)
    svc="${2:-}"
    if [[ -z "$svc" ]]; then
      echo "Usage: $0 wrangler <service>"
      exit 1
    fi
    case "$svc" in
      cassandra-yt-mcp)
        load_env yt-mcp.env
        echo -e "${CYAN}Pushing cassandra-yt-mcp wrangler secrets...${NC}"
        apply_wrangler_secrets cassandra-yt-mcp/worker \
          WORKOS_CLIENT_ID WORKOS_CLIENT_SECRET COOKIE_ENCRYPTION_KEY \
          BACKEND_BASE_URL BACKEND_API_TOKEN CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET
        ;;
      *)
        echo -e "${RED}No wrangler secrets defined for: $svc${NC}"
        exit 1
        ;;
    esac
    ;;
  *)
    list_secrets
    echo -e "\n${YELLOW}Dry run — use './scripts/sync-secrets.sh apply [service]' to apply${NC}"
    ;;
esac
