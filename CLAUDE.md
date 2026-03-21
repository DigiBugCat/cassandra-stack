# cassandra-stack

Multi-repo monorepo (git submodules) for the Cassandra platform. Each `cassandra-*` and `claude-*` subdirectory is its own repo with its own CLAUDE.md. Service-specific dev commands, workflows, and checklists live in `.claude/skills/` — they auto-load, don't reference them here.

## What Lives Where

- **App code**: each service repo (`cassandra-portal`, `cassandra-yt-mcp`, `claude-agent-runner`, etc.)
- **Helm charts**: `cassandra-k8s/apps/<service>/` — ArgoCD watches this repo
- **Terraform**: `cassandra-infra/` — single root module, manual `tofu apply`
- **Dashboards**: `cassandra-observability/dashboards/` — ArgoCD syncs as ConfigMaps
- **ACL policy**: `env/acl.yaml` (gitignored) — baked into auth worker at deploy
- **Secrets**: `env/` (gitignored) — inventory in `env/secrets-registry.yaml`
- **Infra context** (IPs, IDs, domains): `.claude/rules/infra-context.md` (gitignored)

## Hard Rules

- **No PII or infra identifiers in tracked files** — domains, emails, IDP IDs, CF Access IDs, KV namespace IDs come from tfvars or env vars. `wrangler.jsonc` with real IDs is gitignored — only `.example` is tracked.
- **Never kubectl apply/edit/patch on ArgoCD-managed resources** — ArgoCD auto-sync reverts direct changes. All k8s changes go through git + Helm values.
- **Docker images are linux/amd64 only**.
- **MCP servers are HTTP/SSE only** — no stdio.
- **Runner is V2 only** — `unstable_v2_createSession` / `session.send()` / `session.stream()`.
- **BuildKit for image builds** — `moby/buildkit:v0.21.1` at `tcp://buildkitd.infra.svc.cluster.local:1234`. Kaniko is archived. DinD blocks Woodpecker pipelines.
- **Two namespaces only** — `infra` (argocd stays in `argocd`) and `production`. No per-service namespaces.

## Cluster Topology

- **dell-server** — k3s control plane. Cloudflared + ArgoCD pinned here (`role=control-plane-workloads`).
- **pantainos** — k3s agent for all workloads. Local registry at `172.20.0.161:30500`. BuildKit cache on `/scratch` (ZFS).
- **callsonballz + will** — GPU nodes (RTX 5080). Tainted `dedicated=gpu-node:NoSchedule`. WSL2 on Windows, bridged networking.
- Single CF Tunnel (`cassandra-runner`) routes all external traffic through cloudflared on dell-server.

## Foot-guns

- **CF API tokens don't hot-reload permissions** — must ROLL the token to pick up changes. Old value keeps old permissions.
- **Cluster-scoped Helm resources collide** — ClusterRole/ClusterRoleBinding MUST use `{{ .Release.Namespace }}` suffix.
- **SDK V2 `createSession` silently ignores `mcpServers` param** — must call `session.query.setMcpServers()` after.
- **SDK V2 control methods** (`setModel`, `setMcpServers`, `interrupt`) live on `session.query`, NOT the session object.
- **Tool deferral bites MCP** — set `ENABLE_TOOL_SEARCH=false` in runner child env.
- **NVIDIA runtime on k3s** — target `.toml.tmpl` template, NOT `config.toml`. Must contain FULL containerd config.
- **WSL cgroups** — `.wslconfig` needs `kernelCommandLine = cgroup_no_v1=all`.
- **GPU pods need long startup probes** — model loading takes minutes. `failureThreshold: 18`, `periodSeconds: 10`.
- **Woodpecker k8s backend RWX must be false** — local-path provisioner is RWO only.
- **Woodpecker agent auth** — individual tokens, not shared secrets. Token in `woodpecker-agent-secret` k8s secret.
- **yt-dlp needs cookies** — `YTDLP_COOKIES` env var (base64). Auth errors are permanent, no retry. Use stable builds, nightlies have n challenge regressions.
- **Vault sync stale lock** — remove `.sync.lock/` before restarting `ob sync --continuous`.
- **ArgoCD stale helm parameters** — removed Image Updater left `parameters` overrides pinning sha tags. Check with `kubectl -n argocd get application <name> -o jsonpath='{.spec.source.helm.parameters}'`.
