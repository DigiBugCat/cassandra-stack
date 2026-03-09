# Cassandra MCP Service Build Guide

Reference guide for building new MCP services in the Cassandra stack. Based on the `cassandra-yt-mcp` reference implementation.

## Architecture Overview

Every Cassandra MCP service follows a three-layer architecture:

```
Client (Claude, Obsidian, etc.)
  ↓ OAuth 2.1 (MCP protocol)
CF Worker (MCP gateway + WorkOS OAuth)     ← yt-mcp.<domain>
  ↓ Bearer token + CF Access service token
CF Tunnel
  ↓
Backend (k8s pod)                          ← yt-mcp-api.<domain>
```

**Worker** = stateless MCP gateway. Handles OAuth, exposes MCP tools, proxies to backend.
**Backend** = the actual service logic. Runs in k8s, exposed via CF tunnel, protected by CF Access.

For simple services with no heavy compute, the worker alone may suffice (tools can call external APIs directly).

## Repo Structure

Each MCP service lives in its own repo (`DigiBugCat/cassandra-<name>`) and is a submodule of `cassandra-stack`:

```
cassandra-<service>/
├── worker/                  # CF Worker (MCP gateway)
│   ├── src/
│   │   ├── index.ts         # McpAgent class + OAuthProvider export
│   │   ├── backend.ts       # Backend HTTP client helpers
│   │   ├── utils.ts         # WorkOS auth helpers + Props type
│   │   ├── workos-handler.ts    # /authorize + /callback routes (Hono)
│   │   └── workers-oauth-utils.ts  # CSRF, state, session binding (copy as-is)
│   ├── worker-configuration.d.ts   # Env type declaration
│   ├── wrangler.jsonc               # Real config (git-ignored)
│   ├── wrangler.jsonc.example       # Template with placeholders
│   ├── package.json
│   └── tsconfig.json
├── backend/                 # Backend service (if needed)
│   ├── src/
│   ├── Dockerfile
│   ├── pyproject.toml       # or package.json
│   └── tests/
├── infra/                   # Service-specific Terraform modules
│   └── modules/
│       ├── worker-edge/     # KV namespace + DNS CNAME + WAF skip
│       └── backend-access/  # CF Access app + service token + policy
├── .github/workflows/
│   ├── ci.yml               # Tests (ARC runner)
│   └── deploy.yml           # Build + push Docker image (ARC runner)
└── README.md
```

## Step-by-Step: Adding a New MCP Service

### 1. Create the repo

```bash
# Create repo under DigiBugCat org
gh repo create DigiBugCat/cassandra-<service> --public

# Add as submodule in cassandra-stack
cd ~/cassandra-stack
git submodule add https://github.com/DigiBugCat/cassandra-<service>.git
```

### 2. Worker (MCP Gateway)

Copy `cassandra-yt-mcp/worker/` as your starting point. The files you need to modify vs copy as-is:

| File | Action |
|------|--------|
| `src/index.ts` | **Modify** — rename class, register your tools |
| `src/backend.ts` | **Modify** — adjust if your backend API differs |
| `src/utils.ts` | **Copy as-is** — WorkOS auth helpers are generic |
| `src/workos-handler.ts` | **Copy as-is** — OAuth flow is identical |
| `src/workers-oauth-utils.ts` | **Copy as-is** — CSRF/state utilities |
| `worker-configuration.d.ts` | **Modify** — update Env bindings for your service |
| `wrangler.jsonc.example` | **Modify** — update name, class, route |
| `package.json` | **Modify** — update name |
| `tsconfig.json` | **Copy as-is** |

#### index.ts — Key Patterns

```typescript
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { WorkOSHandler } from "./workos-handler";
import type { Props } from "./utils";

// 1. Extend McpAgent with your class name
export class MyServiceMCP extends McpAgent<Env, Record<string, never>, Props> {
  server: any = new McpServer({
    name: "My Service MCP",
    version: "1.0.0",
  });

  // 2. Register tools in init()
  async init() {
    const env = this.env;

    this.server.registerTool(
      "tool_name",
      {
        description: "What this tool does.",
        annotations: { readOnlyHint: true },  // or false for mutations
        inputSchema: {
          param: z.string().describe("Parameter description"),
        },
      },
      async ({ param }: { param: string }) => {
        // Call backend or external API
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      },
    );
  }
}

// 3. resolveExternalToken — validates WorkOS JWTs for M2M/bearer access
async function resolveExternalToken(input: {
  token: string;
  request: Request;
  env: Env;
}): Promise<{ props: Props } | null> {
  // JWT validation logic (copy from yt-mcp)
}

// 4. Default export is the OAuthProvider wrapper
export default new OAuthProvider({
  apiHandler: MyServiceMCP.serve("/mcp"),
  apiRoute: "/mcp",
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: WorkOSHandler as any,
  tokenEndpoint: "/token",
  resolveExternalToken,
});
```

#### Critical wrangler.jsonc Rules

```jsonc
{
  "name": "cassandra-<service>",
  "main": "src/index.ts",
  "compatibility_date": "2025-03-10",
  "compatibility_flags": ["nodejs_compat"],

  // DO binding MUST be named "MCP_OBJECT" — agents library convention
  "durable_objects": {
    "bindings": [{ "class_name": "MyServiceMCP", "name": "MCP_OBJECT" }]
  },

  // Class must be listed in migrations
  "migrations": [{ "new_sqlite_classes": ["MyServiceMCP"], "tag": "v1" }],

  // KV binding MUST be named "OAUTH_KV"
  "kv_namespaces": [{ "binding": "OAUTH_KV", "id": "<from-terraform>" }],

  "routes": [{ "pattern": "<service>.<domain>/*", "zone_name": "<domain>" }]
}
```

**Foot-guns:**
- `MCP_OBJECT` binding name is non-negotiable. The `agents` library looks it up by convention. Custom names silently fail.
- `OAUTH_KV` binding name is required by `@cloudflare/workers-oauth-provider`.
- Your McpAgent class name must match between the export, DO binding `class_name`, and `migrations.new_sqlite_classes`.

#### Worker Dependencies

```json
{
  "dependencies": {
    "@cloudflare/workers-oauth-provider": "^0.3.0",
    "@modelcontextprotocol/sdk": "^1.19.0",
    "agents": "^0.7.5",
    "hono": "^4.12.5",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20260227.0",
    "typescript": "5.9.3",
    "wrangler": "^4.67.0"
  }
}
```

### 3. Backend (if needed)

Only needed if the service has heavy compute, persistent storage, or GPU requirements. For lightweight services that just proxy external APIs, the worker alone is sufficient.

**Key patterns:**
- **Image**: `<registry-ip>:30500/cassandra-<service>/backend:latest` (local registry, never GHCR)
- **linux/amd64 only**
- **Expose `/healthz`** endpoint for k8s probes
- **Auth**: Validate `Authorization: Bearer <token>` from the worker
- **Non-root user** in Dockerfile

### 4. Infrastructure (Terraform)

#### Service-specific modules (in your repo's `infra/modules/`)

**`worker-edge/`** — Creates the KV namespace for OAuth state and DNS record for the worker:
```hcl
resource "cloudflare_workers_kv_namespace" "oauth" {
  account_id = var.account_id
  title      = "${var.worker_script_name}-oauth-state"
}

resource "cloudflare_record" "worker" {
  zone_id = var.zone_id
  name    = var.worker_subdomain
  content = "${var.worker_script_name}.${var.account_id}.workers.dev"
  type    = "CNAME"
  proxied = true
}
```

**`backend-access/`** (only if backend exists) — CF Access app + service token for worker-to-backend auth:
```hcl
resource "cloudflare_zero_trust_access_application" "backend" {
  zone_id = var.zone_id
  name    = var.application_name
  domain  = "${var.backend_subdomain}.${var.domain}"
  type    = "self_hosted"
}

resource "cloudflare_zero_trust_access_service_token" "backend" {
  account_id = var.account_id
  name       = "${var.application_name}-worker"
}

resource "cloudflare_zero_trust_access_policy" "backend" {
  application_id = cloudflare_zero_trust_access_application.backend.id
  zone_id        = var.zone_id
  name           = "Worker service token access"
  decision       = "non_identity"
  include {
    service_token = [cloudflare_zero_trust_access_service_token.backend.id]
  }
}
```

#### Environment composition (in `cassandra-infra/`)

Create `environments/production/<service>/main.tf` that wires up:
1. `cloudflare-tunnel` module (shared, from `cassandra-infra/modules/` via relative path)
2. `worker-edge` module (from your repo's `infra/modules/` via GitHub URL)
3. `backend-access` module (from your repo's `infra/modules/` via GitHub URL, if backend exists)

Service-specific modules are sourced remotely from the public GitHub repo — not via relative filesystem paths. This means `cassandra-infra` doesn't need sibling submodules checked out to run `tofu init/apply`:

```hcl
module "tunnel" {
  source = "../../../modules/cloudflare-tunnel"  # shared, local
  # ...
}

module "worker_edge" {
  source = "github.com/DigiBugCat/cassandra-<service>//infra/modules/worker-edge?ref=main"
  # ...
}

module "backend_access" {
  source = "github.com/DigiBugCat/cassandra-<service>//infra/modules/backend-access?ref=main"
  # ...
}
```

Pin `?ref=main` for latest, or use a commit SHA / tag for stability. After changing a module source, run `tofu init -upgrade` to re-fetch.

### 5. Helm Chart (in `cassandra-k8s/`)

Create `apps/cassandra-<service>/` with:

```
apps/cassandra-<service>/
├── Chart.yaml
├── values.yaml
└── templates/
    ├── _helpers.tpl
    ├── deployment.yaml
    ├── namespace.yaml
    ├── pvc.yaml          # if persistent storage needed
    └── service.yaml
```

**Key patterns:**
- `Recreate` strategy (not `RollingUpdate`) for GPU/singleton workloads
- Cloudflared tunnel sidecar for backend exposure
- Secrets via `secretKeyRef` (manual `kubectl create secret`, never in git)
- `startupProbe` with generous timeout for GPU workloads (failureThreshold: 18, periodSeconds: 10 = 3 min)
- Tolerations + affinity for GPU node targeting (if applicable)

### 6. ArgoCD Applications (in `cassandra-k8s/argocd/apps/`)

**App definition** (`cassandra-<service>.yaml`):
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: cassandra-<service>
  namespace: argocd
  annotations:
    argocd-image-updater.argoproj.io/image-list: >-
      backend=<registry-ip>:30500/cassandra-<service>/backend
    argocd-image-updater.argoproj.io/backend.update-strategy: newest-build
    argocd-image-updater.argoproj.io/write-back-method: argocd
    argocd-image-updater.argoproj.io/backend.helm.image-name: image.repository
    argocd-image-updater.argoproj.io/backend.helm.image-tag: image.tag
spec:
  source:
    repoURL: https://github.com/DigiBugCat/cassandra-k8s.git
    path: apps/cassandra-<service>
    helm:
      valueFiles: [values.yaml]
  destination:
    namespace: cassandra-<service>
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: [CreateNamespace=true]
```

**ARC runner** (`arc-runner-scale-set-<service>.yaml`):
- Copy from yt-mcp's ARC runner definition
- Update `githubConfigUrl`, `runnerScaleSetName`, and resource limits
- Must include `--insecure-registry=<registry-ip>:30500` in DinD dockerd args

### 7. CI/CD Workflows (in your repo's `.github/workflows/`)

**`ci.yml`** — lint, type-check, test on every push/PR:
```yaml
jobs:
  backend:
    runs-on: gh-arc-cassandra-<service>   # ARC runner name
    steps:
      - uses: actions/checkout@v4
      # language-specific test steps
  worker:
    runs-on: gh-arc-cassandra-<service>
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm install && npm run type-check
```

**`deploy.yml`** — build + push Docker image on main push:
```yaml
env:
  REGISTRY: <registry-ip>:30500
  IMAGE_NAME: cassandra-<service>/backend
jobs:
  build-and-push:
    runs-on: gh-arc-cassandra-<service>
    steps:
      - uses: actions/checkout@v4
      # docker build + docker push (NOT buildx — breaks with insecure registries)
```

**Important:** Do NOT use `docker/setup-buildx-action`. The buildx `docker-container` driver ignores DinD's `--insecure-registry` and tries HTTPS. Use the default `docker` driver.

### 8. Secrets

#### Worker secrets (via wrangler)

Every worker needs these:
```bash
wrangler secret put WORKOS_CLIENT_ID        # shared across all services
wrangler secret put WORKOS_CLIENT_SECRET     # shared across all services
wrangler secret put COOKIE_ENCRYPTION_KEY    # unique per service (openssl rand -hex 32)
```

If the worker calls a backend:
```bash
wrangler secret put BACKEND_BASE_URL         # e.g. https://<service>-api.<domain>
wrangler secret put BACKEND_API_TOKEN        # shared secret with backend
wrangler secret put CF_ACCESS_CLIENT_ID      # from terraform output
wrangler secret put CF_ACCESS_CLIENT_SECRET  # from terraform output
```

For metrics push (if using `cassandra-observability`):
```bash
wrangler secret put VM_PUSH_URL              # https://vm-push.<domain>/api/v1/import/prometheus
wrangler secret put VM_PUSH_CLIENT_ID        # from metrics-push terraform output
wrangler secret put VM_PUSH_CLIENT_SECRET    # from metrics-push terraform output
```

#### k8s secrets (via kubectl)

```bash
kubectl create secret generic cassandra-<service>-backend \
  --namespace cassandra-<service> \
  --from-literal=BACKEND_API_TOKEN=<token> \
  --from-literal=OTHER_KEY=<value>

kubectl create secret generic cloudflare-tunnel \
  --namespace cassandra-<service> \
  --from-literal=token=<tunnel-token>
```

#### Update the registry

Add entries to `cassandra-stack/env/secrets-registry.yaml` and `scripts/sync-secrets.sh`.

### 9. WorkOS Configuration

- Add `https://<service>.<domain>/callback` as a redirect URI in the WorkOS dashboard
- All services share one WorkOS application (same client ID/secret)
- Auto-approve: The `/authorize` handler skips the consent screen and redirects straight to WorkOS

### 10. Observability (Metrics + Logging)

Every service must emit metrics and structured logs. There are two metrics patterns depending on where your code runs:

- **k8s backends** — pull-based: expose `/metrics`, VMAgent scrapes
- **CF Workers** — push-based: use `cassandra-observability` package to push to VictoriaMetrics

Logging is the same everywhere: structured JSON to stdout, collected by Vector.

#### Metrics: k8s Backends (Pull)

**Pattern**: Expose a `/metrics` endpoint in Prometheus text format. VMAgent auto-discovers pods with the `prometheus.io/scrape: "true"` annotation.

**Python backends** (FastAPI/Starlette) — use `prometheus_client`:
```python
from prometheus_client import Counter, Gauge, Histogram, CONTENT_TYPE_LATEST, generate_latest

# Prefix all metrics with your service name to avoid collisions
jobs_total = Counter(
    "yt_mcp_jobs_total",
    "Total transcription jobs",
    ["status", "transcriber"],
)

jobs_in_progress = Gauge(
    "yt_mcp_jobs_in_progress",
    "Currently processing jobs",
    ["phase"],
)

transcription_duration_seconds = Histogram(
    "yt_mcp_transcription_duration_seconds",
    "Time to transcribe audio",
    ["transcriber"],
    buckets=[5, 10, 30, 60, 120, 300, 600, 1200],
)

api_requests_total = Counter(
    "yt_mcp_api_requests_total",
    "API requests by endpoint",
    ["endpoint"],
)

api_request_duration_seconds = Histogram(
    "yt_mcp_api_request_duration_seconds",
    "API request latency",
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
)

# Expose at /metrics
@app.get("/metrics")
def prometheus_metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
```

**Node.js backends** — use `prom-client`:
```typescript
import client from "prom-client";

export const register = client.register;
client.collectDefaultMetrics({ register }); // GC, event loop, memory

export const requestsTotal = new client.Counter({
  name: "my_service_requests_total",
  help: "Total requests",
  labelNames: ["method", "path", "status"] as const,
});

// Expose at /metrics
app.get("/metrics", async () => {
  return new Response(await register.metrics(), {
    headers: { "Content-Type": register.contentType },
  });
});
```

**Pod annotations** — add to your deployment template:
```yaml
spec:
  template:
    metadata:
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "{{ .Values.backend.port }}"
        prometheus.io/path: "/metrics"
```

**Skip `/metrics` and `/healthz` from your own request metrics** — they create noise:
```python
_SKIP_METRICS_PATHS = frozenset({"/metrics", "/healthz"})
```

#### Metrics: CF Workers (Push)

Workers are stateless — they can't expose a `/metrics` endpoint for scraping. Instead, use the `cassandra-observability` package to push metrics to VictoriaMetrics after each request.

```typescript
import { pushMetrics, counter, gauge } from "cassandra-observability";

// In your Worker's fetch handler or MCP tool:
ctx.waitUntil(pushMetrics(env, [
  counter("mcp_requests_total", 1, { service: "my-service", status: "200" }),
  gauge("mcp_active_sessions", 5, { service: "my-service" }),
]));
```

**How it works:**
```
CF Worker → POST vm-push.<domain>/api/v1/import/prometheus
          → CF Access (service token auth)
          → CF Tunnel (runner tunnel, extra ingress rule)
          → VMSingle in monitoring namespace
```

**Worker secrets needed** (via `wrangler secret put`):
```bash
wrangler secret put VM_PUSH_URL          # https://vm-push.<domain>/api/v1/import/prometheus
wrangler secret put VM_PUSH_CLIENT_ID    # CF Access service token (from metrics-push terraform module)
wrangler secret put VM_PUSH_CLIENT_SECRET
```

The `metrics-push` Terraform module in `cassandra-observability/infra/modules/metrics-push/` creates the CF Access app + service token for the push endpoint.

Fire-and-forget: `pushMetrics` silently swallows errors so metrics failures never affect request handling.

#### Metric Naming Conventions

- Prefix with service name: `yt_mcp_*`, `mcp_*`
- Counters end in `_total`: `yt_mcp_jobs_total`
- Histograms for durations end in `_seconds`: `yt_mcp_transcription_duration_seconds`
- Gauges for current state: `yt_mcp_jobs_in_progress`, `yt_mcp_jobs_queued`
- Use labels for dimensions (status, phase, endpoint), not separate metric names

**What to instrument** (at minimum):
| Category | Metrics | Type |
|----------|---------|------|
| API layer | Request count by endpoint + status, request latency | Counter, Histogram |
| Core operations | Job/task count by status, duration | Counter, Histogram |
| Queue/pipeline | Queue depth, in-progress count by phase | Gauge |
| Errors | Failure count by reason, retry count | Counter |
| Domain-specific | Whatever matters for your service | Varies |

#### Logging

**Pattern**: Structured JSON to stdout. Vector DaemonSet collects container logs and ships to VictoriaLogs. (Workers log to `console.log` — visible in Cloudflare dashboard, not VictoriaLogs.)

Every log line must be valid JSON with these fields:
```json
{
  "ts": "2026-03-08T12:34:56.789Z",
  "level": "info",
  "scope": "service.component",
  "message": "human_readable_event_name",
  "trace_id": "optional-correlation-id",
  "request_id": "optional-per-request-id",
  "session_id": "optional-session-id",
  "key": "additional structured fields inline"
}
```

**Logger implementation** — both orchestrator and runner use the same pattern (`AsyncLocalStorage` for context propagation):
```typescript
import { AsyncLocalStorage } from "node:async_hooks";

const contextStore = new AsyncLocalStorage<LogContext>();

function emit(level: string, scope: string, message: string, meta?: Record<string, unknown>) {
  const context = contextStore.getStore() || {};
  const payload = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    ...(context.traceId ? { trace_id: context.traceId } : {}),
    ...(context.requestId ? { request_id: context.requestId } : {}),
    ...meta,
  };
  console.log(JSON.stringify(payload));
}
```

**Logging conventions:**
- `scope`: dot-separated component path — `runner.agent`, `orchestrator.session`, `yt_mcp.transcribe`
- `message`: snake_case event name — `turn_start`, `session_created`, `clone_failed`
- Use `meta` for dimensional data, not string interpolation — `{ session_id: id, error: msg }` not `"session ${id} failed: ${msg}"`
- Level `LOG_LEVEL` env var controls verbosity (debug/info/warn/error, default: info)
- Use `logger.event()` for wide events — a single log entry capturing an entire operation with all dimensional context

**What Vector does automatically:**
- Collects all container stdout/stderr via `kubernetes_logs` source
- Parses JSON messages (merges parsed fields into the log entry)
- Enriches with `_namespace`, `_pod`, `_container`, `_node`
- Ships to VictoriaLogs with stream fields for efficient querying

#### Grafana Dashboards

Dashboards live in the `cassandra-observability` repo (`DigiBugCat/cassandra-observability`), not in `cassandra-k8s`. ArgoCD app `observability-dashboards` watches the `dashboards/` directory and syncs ConfigMaps to the `monitoring` namespace.

To add a dashboard for your service:
1. Create `dashboards/<service>.json` in `cassandra-observability`
2. Add it to `dashboards/kustomization.yaml`:
```yaml
configMapGenerator:
  # ... existing entries ...
  - name: cassandra-dashboards-<service>
    files:
      - <service>.json
```
3. Push — ArgoCD auto-syncs

Each dashboard JSON file becomes its own ConfigMap with the `grafana_dashboard: "1"` label (applied by `generatorOptions` in the kustomization). Grafana's sidecar auto-imports all ConfigMaps with this label.

**Dashboard structure** (follow the yt-mcp pattern):
1. **Top row**: Stat panels for key numbers (total ops, success rate, queue depth)
2. **Second row**: Time series for throughput (completed/failed over time, queue depth)
3. **Third row**: Latency histograms (p50/p90/p99 for core operations)
4. **Fourth row**: Distribution histograms, breakdown by type/source
5. **Bottom row**: API layer metrics (request rate, latency)

**Existing dashboards:**
- `home.json` — Platform overview (cluster health, sessions, cost)
- `orchestrator.json` — API rate, errors, latency, sessions, warm pool, token pool
- `sessions.json` — Agent session lifecycle, tokens, cost, spawn times, compactions
- `yt-mcp.json` — Transcription jobs, queue, duration, speed, fallback, API metrics
- `workers.json` — CF Worker/MCP request analytics (uses push metrics)

#### Observability Infrastructure

The platform provides all observability infrastructure — services just emit metrics and logs:

```
                    ┌─────────────────────────────────────┐
                    │          monitoring namespace        │
                    │                                     │
Pod /metrics ──────►│  VMAgent ──► VMSingle (30d, 5Gi)   │
                    │                         ▲           │
CF Worker push ────►│  (via CF Tunnel) ───────┘           │
                    │                                     │
                    │  VMAlert (alerting rules)           │
                    │                                     │
Pod stdout ────────►│  Vector ──► VictoriaLogs (30d,10Gi) │
                    │                                     │
                    │  Grafana (dashboards + datasources) │
                    │    ├─ Prometheus (VMSingle)         │
                    │    └─ VictoriaLogs                  │
                    │                                     │
                    │  node-exporter (per node)           │
                    │  kube-state-metrics                 │
                    └─────────────────────────────────────┘
```

Managed by:
- `vm-k8s-stack` — victoria-metrics-k8s-stack Helm chart with VictoriaLogs + Vector as `extraObjects`
- `observability-dashboards` — ArgoCD app pointing to `cassandra-observability` repo's `dashboards/` directory

### 11. Deploy Sequence

```bash
# 1. Terraform — create CF tunnel, KV namespace, DNS, Access
cd cassandra-infra/environments/production/<service>
source ../../.env
tofu init -backend-config=production.s3.tfbackend
tofu apply

# 2. Get KV namespace ID from terraform output → update wrangler.jsonc

# 3. Set worker secrets
cd cassandra-<service>/worker
wrangler secret put WORKOS_CLIENT_ID
wrangler secret put WORKOS_CLIENT_SECRET
wrangler secret put COOKIE_ENCRYPTION_KEY
# ... service-specific secrets

# 4. Deploy worker
npx wrangler deploy

# 5. Add redirect URI in WorkOS dashboard

# 6. Create k8s secrets
kubectl create secret generic ...

# 7. Add Helm chart to cassandra-k8s/apps/
#    - Include prometheus.io/scrape annotation in deployment template
# 8. Add ArgoCD Application to cassandra-k8s/argocd/apps/
# 9. Add ARC runner scale set to cassandra-k8s/argocd/apps/
# 10. Push cassandra-k8s — ArgoCD picks it up

# 11. Add Grafana dashboard to cassandra-observability/dashboards/
#     - Add JSON file + entry in kustomization.yaml
#     - Push cassandra-observability — ArgoCD syncs dashboards

# 12. Update secrets registry + sync script in cassandra-stack
```

## Design Decisions

### Why CF Worker + Durable Object for MCP?
The `agents` library from Cloudflare provides the MCP server runtime on Durable Objects. Each MCP session gets its own DO instance with SQLite storage. The worker handles OAuth and routing, the DO handles MCP protocol and tool execution.

### Why WorkOS?
Single OAuth provider for all services. Supports Google SSO out of the box. One app registration, per-service redirect URIs. M2M tokens via JWT validation.

### Why auto-approve clients?
These are first-party services. No reason to show a consent screen to the user — they're already authenticating via WorkOS/Google.

### Why CF Access on the backend?
Defense in depth. Even though the backend has its own `BACKEND_API_TOKEN`, CF Access adds a network-level gate. Only the worker's service token can reach the backend through the tunnel.

### Why do services own their own infra modules?
Each service ships its own Terraform modules in `infra/modules/` rather than sharing centralized modules. Services may diverge over time — different auth patterns, extra resources, WAF rules. The environment compositions in `cassandra-infra` source these modules via GitHub URLs (`github.com/DigiBugCat/cassandra-<service>//infra/modules/...?ref=main`), so `cassandra-infra` doesn't depend on sibling checkouts. Only truly generic modules (like `cloudflare-tunnel`) live in `cassandra-infra/modules/`.

### Why local registry instead of GHCR?
Speed. Images stay on-cluster, no egress costs, no rate limits. The tradeoff is manual insecure-registry config on all nodes.

### Why not buildx?
The `docker-container` buildx driver creates its own daemon that doesn't inherit DinD's `--insecure-registry` flag. It tries HTTPS against the HTTP-only local registry and fails. Standard `docker build` uses the DinD daemon directly and works.

### Why Recreate instead of RollingUpdate?
For GPU workloads and singleton services with PVCs. Can't have two pods fighting over the same GPU or volume. For stateless CPU services, `RollingUpdate` is fine.

## Quick Reference: Naming Conventions

| Thing | Pattern | Example |
|-------|---------|---------|
| Repo | `cassandra-<service>` | `cassandra-yt-mcp` |
| Worker name | `cassandra-<service>` | `cassandra-yt-mcp` |
| Worker domain | `<service>.<domain>` | `yt-mcp.<domain>` |
| Backend domain | `<service>-api.<domain>` | `yt-mcp-api.<domain>` |
| k8s namespace | `cassandra-<service>` | `cassandra-yt-mcp` |
| Helm chart | `apps/cassandra-<service>/` | `apps/cassandra-yt-mcp/` |
| Docker image | `cassandra-<service>/backend` | `cassandra-yt-mcp/backend` |
| ARC runner | `gh-arc-cassandra-<service>` | `gh-arc-cassandra-yt-mcp` |
| CF tunnel | `cassandra-<service>` | `cassandra-yt-mcp` |
| KV namespace | `cassandra-<service>-oauth-state` | `cassandra-yt-mcp-oauth-state` |
| DO class | `Cassandra<Service>MCP` | `CassandraYtMCP` |
| Metric prefix | `<service_snake>_*` | `yt_mcp_*` |
| Log scope | `<service_snake>.<component>` | `yt_mcp.transcribe` |
