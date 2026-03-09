#!/usr/bin/env bash
# Scan for secrets across working tree and git history.
# Usage: ./scripts/scan-secrets.sh [--history]
#   No args:    scan current files only (fast)
#   --history:  also scan full git history in all submodules (slow)
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCAN_HISTORY=false
if [[ "${1:-}" == "--history" ]]; then
  SCAN_HISTORY=true
fi

# Same patterns as pre-commit-secrets
SECRET_REGEX='(sk-ant-[a-zA-Z0-9_-]{20,}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|ghu_[a-zA-Z0-9]{36}|ghs_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{22,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----)'

# Files to skip
SKIP_REGEX='\.(lock|svg|png|jpg|ico|woff2?)$|node_modules/|\.git/|pre-commit-secrets$|install-hooks\.sh$|scan-secrets\.sh$|__tests__|fixtures/|\.test\.|\.spec\.'

found=false

scan_tree() {
  local dir="$1"
  local label="$2"

  if [ ! -d "$dir" ]; then
    return
  fi

  # Use git ls-files to only scan tracked files
  local matches
  matches=$(cd "$dir" && git ls-files -z 2>/dev/null \
    | xargs -0 grep -lnE "$SECRET_REGEX" 2>/dev/null \
    | grep -vE "$SKIP_REGEX" || true)

  if [ -n "$matches" ]; then
    found=true
    echo -e "${RED}  [$label] Secrets found in working tree:${NC}"
    while IFS= read -r file; do
      echo -e "    ${YELLOW}$file${NC}"
      (cd "$dir" && grep -nE "$SECRET_REGEX" "$file" | head -3 | while IFS= read -r line; do
        echo "      $(echo "$line" | cut -c1-100)..."
      done)
    done <<< "$matches"
  else
    echo -e "${GREEN}  [$label] Working tree clean${NC}"
  fi
}

scan_history() {
  local dir="$1"
  local label="$2"

  if [ ! -d "$dir/.git" ] && [ ! -f "$dir/.git" ]; then
    return
  fi

  local matches
  matches=$(cd "$dir" && git log --all --diff-filter=A -p 2>/dev/null \
    | grep -nE "^\+.*($SECRET_REGEX)" \
    | grep -vE "$SKIP_REGEX" \
    | head -20 || true)

  if [ -n "$matches" ]; then
    found=true
    echo -e "${RED}  [$label] Secrets found in git history:${NC}"
    echo "$matches" | head -10 | while IFS= read -r line; do
      echo "    $(echo "$line" | cut -c1-100)..."
    done
    local count
    count=$(echo "$matches" | wc -l | tr -d ' ')
    if [ "$count" -gt 10 ]; then
      echo "    ... and $((count - 10)) more"
    fi
  else
    echo -e "${GREEN}  [$label] Git history clean${NC}"
  fi
}

echo ""
echo "=== Secret Scanner ==="
echo ""

# Scan parent repo
echo "Scanning working tree..."
scan_tree "$REPO_ROOT" "cassandra-stack"

# Scan submodules
for sub in cassandra-obsidian claude-agent-runner cassandra-infra cassandra-k8s cassandra-yt-mcp; do
  if [ -d "$REPO_ROOT/$sub" ]; then
    scan_tree "$REPO_ROOT/$sub" "$sub"
  fi
done

if $SCAN_HISTORY; then
  echo ""
  echo "Scanning git history (this may take a while)..."
  scan_history "$REPO_ROOT" "cassandra-stack"
  for sub in cassandra-obsidian claude-agent-runner cassandra-infra cassandra-k8s cassandra-yt-mcp; do
    if [ -d "$REPO_ROOT/$sub" ]; then
      scan_history "$REPO_ROOT/$sub" "$sub"
    fi
  done
fi

echo ""
if $found; then
  echo -e "${RED}SECRETS DETECTED — review the files above${NC}"
  exit 1
else
  echo -e "${GREEN}All clean — no secrets found${NC}"
  exit 0
fi
