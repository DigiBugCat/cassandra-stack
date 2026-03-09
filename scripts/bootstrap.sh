#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_DIR="$REPO_ROOT/env"

copy_env() {
  local src="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  echo "  $src → $dest"
}

echo "Populating .env files from env/"
echo ""

copy_env "$ENV_DIR/runner.env"   "$REPO_ROOT/claude-agent-runner/.env"
copy_env "$ENV_DIR/infra.env"    "$REPO_ROOT/cassandra-infra/environments/production/runner/.env"
copy_env "$ENV_DIR/obsidian.env" "$REPO_ROOT/cassandra-obsidian/.env.local"

echo ""
echo "Done. k8s secrets in env/k8s.env are for manual kubeseal use."
