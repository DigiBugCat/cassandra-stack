# Namespace Consolidation

Completed 2026-03-21. Consolidated from 10 per-service namespaces down to 2 (plus ArgoCD).

## Namespace Layout

| Namespace | Services | Node |
|-----------|----------|------|
| `infra` | cloudflared, buildkitd, registry, grafana, victoria-metrics, victoria-logs, vmagent, vmalert, kube-state-metrics, node-exporter, vector, woodpecker | cloudflared on dell-server, rest on pantainos |
| `production` | auth, portal, runner, fmp, yt-mcp, discord-mcp | pantainos (GPU worker on callsonballz/will) |
| `argocd` | ArgoCD (all components) | dell-server |
| `claude-runner-dev` | runner dev environment | pantainos |

## Service Renames

k8s resource names (Deployment, Service, PVC) were renamed. Secret names were **not** renamed.

| Old Name | New Name | ArgoCD App | Chart Path |
|----------|----------|------------|------------|
| `cassandra-auth` | `auth` | `auth` | `apps/auth` |
| `cassandra-portal` | `portal` | `portal` | `apps/portal` |
| `cassandra-fmp` | `fmp` | `fmp` | `apps/fmp` |
| `cassandra-yt-mcp` | `yt-mcp` | `yt-mcp` | `apps/yt-mcp` |
| `cassandra-discord-mcp` | `discord-mcp` | `discord-mcp` | `apps/discord-mcp` |
| `cassandra-twitter-mcp` | `twitter-mcp` | *(not deployed)* | `apps/twitter-mcp` |
| `claude-runner` | `claude-runner` | `claude-runner` | `apps/claude-runner` |

## Auth is Cluster-Internal

Auth has no external DNS or tunnel route. All services reach it via cluster-internal FQDN:

```
http://auth.production.svc.cluster.local:8080
```

This is set in the `AUTH_URL` key of each service's k8s secret. No CF tunnel round-trip.

## Secrets

Secrets kept their original names. They are **not** managed by ArgoCD — they're manually created via `kubectl create secret`.

### production namespace

| Secret | Used By | Keys |
|--------|---------|------|
| `admin-key` | runner | ADMIN_API_KEY |
| `claude-tokens` | runner | CLAUDE_CODE_OAUTH_TOKEN |
| `git-tokens` | runner | GITHUB_TOKEN |
| `obsidian-auth` | runner | OBSIDIAN_AUTH_TOKEN, OBSIDIAN_E2EE_PASSWORD |
| `auth-secret` | runner | AUTH_URL, AUTH_SECRET |
| `acl-auth` | runner | AUTH_URL, AUTH_SECRET |
| `auth` | auth service | AUTH_SECRET |
| `cassandra-portal` | portal | AUTH_URL, AUTH_SECRET, CREDENTIALS_KEY, RUNNER_URL, RUNNER_ADMIN_KEY, DOMAIN, DISCORD_MCP_URL, DEFAULT_USER_EMAIL |
| `cassandra-fmp` | fmp | AUTH_URL, AUTH_SECRET |
| `cassandra-yt-mcp-backend` | yt-mcp coordinator | BACKEND_API_TOKEN, HUGGINGFACE_TOKEN, YTDLP_COOKIES |
| `cassandra-yt-mcp-mcp` | yt-mcp MCP sidecar | AUTH_URL, AUTH_SECRET |
| `cassandra-yt-mcp-deepgram` | yt-mcp coordinator + downloader | DEEPGRAM_API_KEY |
| `discord-mcp-controller` | discord-mcp | AUTH_URL, AUTH_SECRET, WORKOS_CLIENT_ID, WORKOS_CLIENT_SECRET, WORKOS_AUTHKIT_DOMAIN, JWT_SIGNING_KEY, STORAGE_ENCRYPTION_KEY |
| `discord-mcp-postgres` | discord-mcp postgres | POSTGRES_PASSWORD |

### infra namespace

| Secret | Used By | Keys |
|--------|---------|------|
| `cloudflare-tunnel` | cloudflared | token |
| `woodpecker-github` | woodpecker server | WOODPECKER_GITHUB_CLIENT, WOODPECKER_GITHUB_SECRET |
| `woodpecker-agent-secret` | woodpecker agent | WOODPECKER_AGENT_SECRET |

## Tunnel Routes

All routes go through the single CF tunnel (`cassandra-runner`). Cloudflared runs in the `infra` namespace on dell-server.

| Hostname | Target |
|----------|--------|
| `claude-runner.cassandrasedge.com` | `claude-orchestrator.production.svc.cluster.local:8080` |
| `portal.cassandrasedge.com` | `portal.production.svc.cluster.local:8080` |
| `grafana.cassandrasedge.com` | `grafana.infra.svc.cluster.local:3000` |
| `argocd.cassandrasedge.com` | `argocd-server.argocd.svc.cluster.local:443` |
| `vm-push.cassandrasedge.com` | `vmsingle-vm-k8s-stack-victoria-metrics-k8s-stack.infra.svc:8428` |
| `ci.cassandrasedge.com` | `woodpecker-server.infra.svc.cluster.local:80` |
| `yt-mcp-api.cassandrasedge.com` | `yt-mcp.production.svc.cluster.local:3000` |
| `yt-mcp-mcp.cassandrasedge.com` | `yt-mcp.production.svc.cluster.local:3003` |
| `fmp.cassandrasedge.com` | `fmp.production.svc.cluster.local:3003` |
| `discord-mcp.cassandrasedge.com` | `discord-mcp.production.svc.cluster.local:3003` |

## BuildKit

Address changed from `buildkitd.buildkitd.svc.cluster.local:1234` to:

```
tcp://buildkitd.infra.svc.cluster.local:1234
```

Updated in all `.woodpecker.yaml` files across service repos.

## What Was Lost During Migration

PVCs are namespace-scoped. When old namespaces were pruned, PVC data was lost:

- **Woodpecker server DB** — needs GitHub OAuth re-login and agent re-registration at `ci.cassandrasedge.com`
- **Auth DB** — fresh (re-initialized on startup)
- **Portal DB** — fresh (re-initialized on startup)
- **Discord-mcp postgres** — fresh (bridges need re-provisioning)
- **Orchestrator DB** — sessions lost (acceptable, ephemeral)
- **VictoriaMetrics/Logs** — historical metrics lost (acceptable)

## Files Changed

### cassandra-k8s
- `argocd/apps/*.yaml` — renamed apps, updated destination namespaces
- `apps/*/` — renamed chart dirs, updated template helpers
- `apps/buildkitd/deployment.yaml` — removed hardcoded namespace
- `apps/cloudflared/deployment.yaml` — namespace: infra

### cassandra-infra
- `tunnel.tf` — all service routes updated to new namespaces and names

### All service repos (.woodpecker.yaml)
- BuildKit address: `buildkitd.infra.svc.cluster.local`
- kubectl restart targets: `-n production`
