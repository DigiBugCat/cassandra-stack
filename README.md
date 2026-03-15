# Cassandra Stack

AI agent platform — multi-session Claude Code runner with Obsidian integration, MCP services, and GPU transcription. This umbrella repo links all components as git submodules.

## Architecture

```
                         ┌─────────────────────────────────────────────────────────┐
                         │                    Cloudflare Edge                      │
                         │                                                         │
  ┌──────────────┐       │  ┌──────────────┐   ┌──────────────┐                   │
  │   Obsidian   │ WS/   │  │    Portal     │   │   YT-MCP     │   CF Workers     │
  │   Plugin     │─HTTP──▶│  │    Worker     │   │   Worker     │   (auto-deploy   │
  │              │       │  │              │   │   (MCP+OAuth) │    on push)      │
  └──────────────┘       │  └──────┬───────┘   └──────┬───────┘                   │
        │                │         │                   │                           │
        │                │         │  ┌────────────────┤                           │
        │                │         │  │  MCP_KEYS KV   │ (shared)                 │
        │                │         │  └────────────────┘                           │
        │                │         │                                               │
        │                │  ┌──────┴───────────────────────────────┐               │
        │                │  │           CF Tunnel                   │               │
        │                │  └──────┬───────────────────────────────┘               │
        │                └─────────┼───────────────────────────────────────────────┘
        │                          │
        │                          ▼
        │                ┌─────────────────────────────────────────────────────────┐
        │                │                    k3s Cluster                          │
        │                │                                                         │
        │                │  ┌──────────────┐   ┌──────────────┐                   │
        │                │  │ Orchestrator  │   │  YT-MCP      │                   │
        └───────────────▶│  │ (HTTP+WS)    │   │  Backend     │◄── GPU nodes      │
                         │  │              │   │  (ASR+diar.) │    (RTX 5080)     │
                         │  └──────┬───────┘   └──────────────┘                   │
                         │         │                                               │
                         │         ▼                                               │
                         │  ┌──────────────┐   ┌──────────────┐                   │
                         │  │   Runner      │   │ VictoriaMetrics                  │
                         │  │   Pods        │   │ + Grafana    │◄── VMAgent scrape │
                         │  │ (Claude SDK)  │   │ + VMLogs     │                   │
                         │  └──────────────┘   └──────────────┘                   │
                         │                            ▲                            │
                         │  ┌──────────────┐          │                            │
                         │  │   ArgoCD      │          │  metrics push             │
                         │  │              │          │  (CF Workers)             │
                         │  │              │          │                            │
                         │  └──────────────┘          │                            │
                         └────────────────────────────┼────────────────────────────┘
                                                      │
                         ┌────────────────────────────┘
                         │
              ┌──────────┴──────────────────────────────────────────────────────────┐
              │                         CI/CD Pipelines                             │
              │                                                                     │
              │  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
              │  │ claude-agent-   │  │ cassandra-yt-mcp  │  │ cassandra-portal  │  │
              │  │ runner          │  │                    │  │                   │  │
              │  │                 │  │ Docker → registry  │  │ type-check →     │  │
              │  │ Docker → local  │  │ Wrangler → CF Edge │  │ Wrangler → CF    │  │
              │  │ registry →     │  │                    │  │ Edge              │  │
              │  │ ArgoCD sync    │  │ ArgoCD sync        │  │                   │  │
              │  └─────────────────┘  └──────────────────┘  └───────────────────┘  │
              │                                                                     │
              │  Woodpecker CI (self-hosted) + BuildKit (image builds)              │
              └─────────────────────────────────────────────────────────────────────┘

              ┌─────────────────────────────────────────────────────────────────────┐
              │                      Terraform (manual apply)                       │
              │                                                                     │
              │  cassandra-infra: CF tunnels, DNS, WAF, Access policies, KV         │
              └─────────────────────────────────────────────────────────────────────┘
```

## Submodules

| Repo | Description | CI/CD |
|------|-------------|-------|
| [cassandra-obsidian](https://github.com/DigiBugCat/cassandra-obsidian) | Obsidian plugin — chat UI, WebSocket streaming, tool rendering | — |
| [claude-agent-runner](https://github.com/DigiBugCat/claude-agent-runner) | Multi-session agent orchestrator + Docker/k8s runner | Woodpecker → BuildKit → local registry → ArgoCD |
| [cassandra-yt-mcp](https://github.com/DigiBugCat/cassandra-yt-mcp) | YouTube MCP service — GPU transcription + CF Worker + FastMCP sidecar | Woodpecker → BuildKit → ArgoCD (backend), Wrangler CD (worker) |
| [cassandra-portal](https://github.com/DigiBugCat/cassandra-portal) | Portal — dashboard, tenant keys, MCP API key management | Woodpecker → Wrangler CD |
| [cassandra-auth](https://github.com/DigiBugCat/cassandra-auth) | Shared MCP auth (TS + Python) + centralized ACL service | Woodpecker → type-check + Wrangler CD |
| [cassandra-observability](https://github.com/DigiBugCat/cassandra-observability) | Shared Worker metrics push + Grafana dashboards | Type-check CI |
| [cassandra-k8s](https://github.com/DigiBugCat/cassandra-k8s) | Helm charts + ArgoCD GitOps | ArgoCD watches repo |
| [cassandra-infra](https://github.com/DigiBugCat/cassandra-infra) | Terraform — Cloudflare tunnels, DNS, WAF, Access | Manual `tofu apply` |

## Quick Start

```bash
git clone --recurse-submodules https://github.com/DigiBugCat/cassandra-stack.git
cd cassandra-stack
```

## Docs

- [MCP Service Build Guide](docs/mcp-service-build-guide.md) — full reference for adding new MCP services
- [Repo Testing Plans](docs/plan/testing/README.md) — per-repo notes on what to test, validate, or skip
