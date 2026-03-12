# cassandra-stack

## Conventions & Preferences
- **Always use latest stable versions** for all pinned images, chart versions, and dependencies. Check latest before adding any new reference.
- **Woodpecker CI for all pipelines**: All CI/CD runs on self-hosted Woodpecker CI (`ci.cassandrasedge.com`) on the k3s cluster. Pipeline pods spawned via Kubernetes backend. No GitHub Actions, no ARC runners.
- **No PII or infra identifiers in tracked files**: Domains, email addresses, email domains, IDP IDs, CF Access IDs, KV namespace IDs, and any other environment-specific identifiers MUST come from tfvars or environment variables — never hardcoded in `.tf` files, worker scripts, or READMEs. Use generic placeholders in descriptions. `wrangler.jsonc` files with real IDs MUST be gitignored — only `wrangler.jsonc.example` (with placeholders) is tracked. Real values for context live in `.claude/rules/` (gitignored) and `env/` (gitignored).

## Deployment Philosophy
- **CI/CD is for images, ArgoCD, and Workers**: Woodpecker CI builds/pushes Docker images tagged `latest`. ArgoCD syncs Helm charts that use `latest` with `pullPolicy: Always` — no Image Updater, no git-sha tags. CF Workers auto-deploy on push to main via `wrangler deploy` in Woodpecker pipelines.
- **Terraform is manual**: `cassandra-infra` resources (CF tunnels, DNS, Workers, Access policies) are applied locally with `terraform apply`. No plan/apply pipelines.
- **Worker CD pattern**: Each Worker repo has a `.woodpecker.yaml` pipeline triggered on push to main. `wrangler.jsonc` is templated at deploy time from Woodpecker secrets (KV IDs, route patterns) — never committed. Shared `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` as org-level Woodpecker secrets.
- **ArgoCD handles k8s deploys**: Helm charts in `cassandra-k8s`, ArgoCD watches the repo. Don't build custom deploy scripts or CI steps for k8s resources.
- **Docker images are linux/amd64 only**.
- **MCP servers are HTTP/SSE only**: No stdio. Config shape is `{type, url, headers}`, passed as `RUNNER_MCP_SERVERS` env var.
- **Runner is V2 only**: No V1 code. Uses `unstable_v2_createSession` / `session.send()` / `session.stream()`.
- **Portal design**: Dense layout, Sora font. Runner tokens prefixed with `cassandra/` to scope from other account tokens. MCP keys prefixed with `mcp_` and scoped per service.
- **Orchestrator needs ClusterRole** (not Role): It creates tenant namespaces (`claude-t-{id}`) and spawns pods across them.
- **CF tunnel proxies WebSockets fine**: If WS fails through CF but works via port-forward, the bug is client-side (race conditions, auth), not Cloudflare.
- **k3d is local, kubectl is remote**: Don't confuse `k3d` commands (local dev cluster) with `kubectl` (remote VPS production cluster).

## MCP Worker Pattern (for porting new services)

All Cassandra MCP services use the same CF Worker + WorkOS OAuth pattern. Reference implementation: `cassandra-yt-mcp/worker/`.

### Auth: Two paths
MCP workers support two auth methods in `resolveExternalToken`:
1. **MCP API key** (`Bearer mcp_...`): Checked first. Looks up the key in shared `MCP_KEYS` KV namespace. Key must have `service` field matching the worker's service ID (e.g. `"yt-mcp"`). No OAuth needed — ideal for Obsidian clients and partners.
2. **WorkOS JWT** (fallback): Standard OAuth flow for browser-based access.

Keys are created via the portal (`cassandra-portal`), scoped to a specific service. A yt-mcp key is rejected by other MCP services.

### Portal integration
When adding a new MCP service, register it in `cassandra-portal/src/mcp-keys.ts` → `MCP_SERVICES` array:
```ts
{ id: "my-service", name: "my-service", description: "What it does", status: "active" }
```
The portal UI will show it in the service nav and allow key creation scoped to it.

### Critical gotchas when creating a new MCP Worker:
- **Durable Object binding MUST be named `MCP_OBJECT`** — the `agents` library looks up this name by convention. Custom names like `MY_SERVICE_OBJECT` will fail with "Could not find McpAgent binding for MCP_OBJECT".
- **`migrations.new_sqlite_classes`** must list your McpAgent class name (e.g. `["MyServiceMCP"]`)
- **KV namespace binding MUST be named `OAUTH_KV`** — used by the OAuth provider for state management
- **KV namespace binding `MCP_KEYS`** — shared namespace for API key auth. Same namespace ID across all MCP workers + portal.
- **Service scope check in `resolveExternalToken`** — must verify `meta.service === "your-service-id"` to enforce key scoping.
- **Auto-approve clients** — skip the consent screen, redirect straight to WorkOS. No reason to show an approval dialog for first-party services.
- **Add redirect URI in WorkOS** — each service needs `https://<service>.<domain>/callback` added in the WorkOS dashboard
- **One WorkOS app for all services** — shared client ID/secret, per-service redirect URIs

### New service checklist:
1. Copy `worker/` from `cassandra-yt-mcp` as template
2. Update `wrangler.jsonc.example`: name, class name in migrations + bindings, route pattern (placeholders only)
3. Keep binding names as `MCP_OBJECT`, `OAUTH_KV`, `MCP_KEYS` (DO NOT change)
4. Add `MCP_KEYS` KV binding with the shared namespace ID (from `tofu output mcp_keys_kv_namespace_id` in portal env)
5. Add `mcp_` key check in `resolveExternalToken` with `meta.service === "your-service-id"`
6. Register the service in `cassandra-portal/src/mcp-keys.ts` → `MCP_SERVICES`
7. Create infra modules in your repo's `infra/modules/` directory (follow `cassandra-yt-mcp` pattern)
8. Create `<service>.tf` in `cassandra-infra/` with module block (local path source) + outputs
9. `tofu apply` in `cassandra-infra/` → get OAUTH_KV namespace ID from output
10. Set wrangler secrets (WORKOS_CLIENT_ID, WORKOS_CLIENT_SECRET, COOKIE_ENCRYPTION_KEY, + service-specific)
11. Add redirect URI in WorkOS dashboard
12. Add `.woodpecker.yaml` pipeline (copy from `cassandra-portal/.woodpecker.yaml`), template `wrangler.jsonc` from Woodpecker secrets
13. Add Woodpecker secrets on the repo: org-level `cloudflare_api_token`/`cloudflare_account_id` (shared), plus repo-level service-specific KV IDs and route pattern/zone
14. Store all secret values in `cassandra-stack/env/github-actions.env` and update `env/secrets-registry.yaml`
15. Push to main — Woodpecker pipeline deploys automatically

### Secrets pattern:
- **k8s secrets**: `kubectl create secret generic` — never in git
- **Worker secrets**: `wrangler secret put` — never in git
- **Raw values**: stored in `cassandra-stack/env/` (gitignored)
- **Registry**: `env/secrets-registry.yaml` — inventory of all secrets per service (source file, namespace, key mappings)
- When adding new services, update the registry

## Observability

### Rules
- **All metrics go to VictoriaMetrics** — single metrics store for both k8s-scraped and Worker-pushed metrics. No separate analytics DBs.
- **All Grafana dashboards live in `cassandra-observability/dashboards/`** — NOT in `cassandra-k8s/monitoring/`. ArgoCD app `observability-dashboards` syncs them as ConfigMaps with `grafana_dashboard: "1"` label.
- **Workers MUST use `pushMetrics()` from `cassandra-observability`** — fire-and-forget via `ctx.waitUntil()`. Never block the response on metrics.
- **Worker metrics auth is CF Access service token** — machine-to-machine, NOT Google OAuth. One shared service token for all Workers.
- **Every new Worker service MUST push at minimum**: `mcp_requests_total` (with `service`, `status`, `path` labels). Additional service-specific metrics are encouraged.
- **Dashboard JSON files are standalone** — no inline JSON in YAML ConfigMaps. Kustomize `configMapGenerator` wraps them.

### Architecture
```
CF Worker (portal, yt-mcp, future)
  → ctx.waitUntil(pushMetrics(env, [...]))
  → POST vm-push.<domain>/api/v1/import/prometheus
  → CF Access (service token auth)
  → CF Tunnel (runner tunnel, extra ingress rule)
  → vmsingle-vm-k8s-stack-victoria-metrics-k8s-stack.monitoring.svc:8428
```

### Guidelines
- **Metric naming**: Use `mcp_` prefix for cross-service metrics (e.g. `mcp_requests_total`), service-specific prefix for service-only metrics (e.g. `yt_mcp_jobs_total`).
- **Labels**: Keep cardinality low. Use `service`, `status`, `path`, `operation`, `key_name`. Avoid high-cardinality labels like request IDs or full URLs.
- **Shared utility**: `cassandra-observability/src/metrics.ts` — `pushMetrics()`, `counter()`, `gauge()`, `histogram()`.
- **Terraform**: `cassandra-infra/observability.tf` — CF Access app + service token for vm-push endpoint.
- **Worker secrets** (via `wrangler secret put`): `VM_PUSH_URL`, `VM_PUSH_CLIENT_ID`, `VM_PUSH_CLIENT_SECRET`.
- **Adding a dashboard**: Create `dashboards/<name>.json`, add to `dashboards/kustomization.yaml` configMapGenerator, push — ArgoCD syncs automatically.
- **k8s backend services** (runner, yt-mcp backend) expose `/metrics` for VMAgent to scrape — they do NOT use the push path.

## Foot-guns & Gotchas
- **CF API tokens don't hot-reload permissions**: After adding/removing permissions on a Cloudflare API token, you must **roll** the token to get a new value. The old value keeps the old permission set. Update the new value in Woodpecker secrets + `env/github-actions.env`.
- **Cluster-scoped Helm resources collide across envs**: ClusterRole/ClusterRoleBinding MUST have unique names per env — use `{{ .Release.Namespace }}` suffix. Otherwise last ArgoCD sync wins and the other env's SA loses permissions (403).
- **SDK V2 session API is misleading**: Control methods (`setModel`, `setMcpServers`, `interrupt`, etc.) live on `session.query`, NOT the session object. `session` only exposes `send`, `stream`, `close`.
- **SDK V2 createSession silently ignores mcpServers param**: The wrapper hardcodes `mcpServers:{}`. Must call `session.query.setMcpServers()` after creation.
- **Tool deferral bites MCP**: Claude CLI defers ALL MCP tools behind `ToolSearch` by default. Set `ENABLE_TOOL_SEARCH=false` in runner child env to load tools eagerly.
- **NVIDIA runtime on k3s**: nvidia-ctk must target the `.toml.tmpl` template, NOT `config.toml` — k3s regenerates config.toml on restart and your changes vanish. The template must contain the FULL k3s containerd config (CNI, flannel, registry paths, etc.) — not just the NVIDIA runtime block, or flannel/CNI won't initialize and the node stays NotReady.
- **WSL cgroups**: `.wslconfig` needs `kernelCommandLine = cgroup_no_v1=all` — hybrid v1/v2 breaks kubelet.
- **GPU device plugin**: Uses env `CONFIG_FILE=/config/config.yaml`, NOT `--config` flag.
- **GPU pods need long startup probes**: Model loading takes minutes. Use `startupProbe` with `failureThreshold: 18` + `periodSeconds: 10` (3 min window).
- **k3s agent via LAN not Tailscale**: WSL can't reach Tailscale IPs directly, so GPU nodes join via LAN IP.
- **Multiple GPU nodes**: Each needs unique WSL MAC in `.wslconfig` to avoid DHCP collision. See `.claude/rules/infra-context.md` for IPs and SSH details.
- **WSL SSH hangs for first-run**: `wsl --install` + first `wsl` launch needs interactive terminal for user creation. Can't do it over SSH.
- **CF Access is disabled for the runner**: Auth is tenant API keys in the orchestrator, not CF Access service tokens.
- **Woodpecker k8s backend**: Steps run sequentially in one pod — DinD detached services DON'T work (block the pipeline forever). Use **Kaniko** (`gcr.io/kaniko-project/executor:debug`) for daemonless builds. Pass `--insecure` for the HTTP local registry.
- **Woodpecker 3.x agent auth**: Agents need individual tokens (not shared secrets). Register agent via API, put the token in a manually-managed k8s secret (`woodpecker-agent-secret`), reference via `extraSecretNamesForEnvFrom`. The Helm-generated default secret has a different value.
- **Woodpecker k8s backend RWX**: `WOODPECKER_BACKEND_K8S_STORAGE_RWX` must be `"false"` — `local-path` provisioner only supports RWO.
- **yt-dlp cookie auth**: YouTube blocks yt-dlp without cookies. `YTDLP_COOKIES` env var (base64-encoded Netscape cookies) decoded to file at startup. Refresh from Firefox: `yt-dlp --cookies-from-browser firefox --cookies /tmp/yt-cookies.txt`. Auth errors ("sign in", "bot") are permanent — jobs fail immediately, no retry.
- **yt-dlp format fallback**: Downloader tries `bestaudio` → `best` → no selector. Handles `n` challenge failures where only limited formats are available.
- **yt-dlp stable cron**: Woodpecker cron `ytdlp-update` rebuilds coordinator image daily at 6am UTC with `--cache=false` to pick up latest yt-dlp stable. Nightly builds have regressions (n challenge solver). Coordinator image includes `nodejs` for JS challenge solving.
- **yt-dlp nightly has n challenge regressions**: Nightlies can break YouTube's n parameter challenge solver. Stable releases are more reliable. If downloads fail with "Requested format is not available" + "n challenge solving failed", check yt-dlp version.
- **Vault sync stale lock**: `ob sync --continuous` can exit code 1 — remove `.sync.lock/` before restarting.
