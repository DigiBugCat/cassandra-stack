# Cassandra Stack

AI agent platform — multi-session Claude Code runner with Obsidian integration, MCP services, and GPU transcription. This umbrella repo links all components as git submodules.

## Submodules

| Repo | Description |
|------|-------------|
| [cassandra-obsidian](https://github.com/DigiBugCat/cassandra-obsidian) | Obsidian plugin — chat UI, WebSocket streaming, tool rendering |
| [claude-agent-runner](https://github.com/DigiBugCat/claude-agent-runner) | Multi-session agent orchestrator + Docker/k8s runner |
| [cassandra-yt-mcp](https://github.com/DigiBugCat/cassandra-yt-mcp) | YouTube MCP service — GPU transcription backend + CF Worker gateway |
| [cassandra-portal](https://github.com/DigiBugCat/cassandra-portal) | Portal — dashboard, tenant keys, MCP API key management |
| [cassandra-observability](https://github.com/DigiBugCat/cassandra-observability) | Shared Worker metrics push + Grafana dashboards |
| [cassandra-k8s](https://github.com/DigiBugCat/cassandra-k8s) | Helm charts + ArgoCD GitOps |
| [cassandra-infra](https://github.com/DigiBugCat/cassandra-infra) | Terraform — Cloudflare tunnels, DNS, WAF, Access |

## Quick Start

```bash
git clone --recurse-submodules https://github.com/DigiBugCat/cassandra-stack.git
cd cassandra-stack
```

## Docs

- [MCP Service Build Guide](docs/mcp-service-build-guide.md) — full reference for adding new MCP services
