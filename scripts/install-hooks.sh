#!/usr/bin/env bash
# Install the pre-commit secret scanner into each submodule and the parent repo.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_SRC="$REPO_ROOT/scripts/pre-commit-secrets"

if [ ! -f "$HOOK_SRC" ]; then
  echo "Error: $HOOK_SRC not found"
  exit 1
fi

install_hook() {
  local hooks_dir="$1"
  local label="$2"
  local dest="$hooks_dir/pre-commit"

  mkdir -p "$hooks_dir"

  if [ -f "$dest" ] && ! grep -q "pre-commit-secrets" "$dest" 2>/dev/null; then
    # Existing pre-commit hook — append our scanner
    echo "" >> "$dest"
    echo "# Secret scanner (installed by install-hooks.sh)" >> "$dest"
    echo "\"$HOOK_SRC\"" >> "$dest"
    echo "  $label: appended to existing pre-commit hook"
  else
    # Create new pre-commit hook
    cat > "$dest" << EOF
#!/usr/bin/env bash
# Secret scanner (installed by install-hooks.sh)
"$HOOK_SRC"
EOF
    chmod +x "$dest"
    echo "  $label: installed"
  fi
}

echo "Installing pre-commit secret scanner..."
echo ""

# Parent repo
install_hook "$REPO_ROOT/.git/hooks" "cassandra-stack (parent)"

# Submodules — their git dirs live under .git/modules/<name>/
for submodule in cassandra-obsidian claude-agent-runner cassandra-infra cassandra-k8s; do
  sub_git_dir="$REPO_ROOT/.git/modules/$submodule"
  if [ -d "$sub_git_dir" ]; then
    install_hook "$sub_git_dir/hooks" "$submodule"
  else
    echo "  $submodule: skipped (not initialized)"
  fi
done

echo ""
echo "Done. Secret scanning is active on all repos."
