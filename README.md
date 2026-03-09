# Cassandra Stack

AI-powered Obsidian plugin backed by a multi-session Claude Code agent runner. This umbrella repo links all components as git submodules.

## Architecture

```
cassandra-stack/
├── cassandra-obsidian/    # Obsidian plugin (TypeScript, chat UI)
├── claude-agent-runner/   # Orchestrator + runner (Node.js, Docker, k8s)
├── cassandra-yt-mcp/      # YouTube MCP service (backend + Worker + infra modules)
├── cassandra-k8s/         # Helm charts + ArgoCD GitOps
├── cassandra-infra/       # Terraform (Cloudflare tunnels, DNS)
├── env/                   # Environment configs per submodule
└── scripts/               # Bootstrap and deploy helpers
```

## Quick Start

```bash
# Clone with submodules
git clone --recurse-submodules git@github.com:DigiBugCat/cassandra-stack.git
cd cassandra-stack

# Fill in env/runner.env, env/infra.env, etc. with your values
# Then populate .env files into each submodule:
./scripts/bootstrap.sh
```

## Submodules

| Repo | Description |
|------|-------------|
| [cassandra-obsidian](https://github.com/DigiBugCat/cassandra-obsidian) | Obsidian plugin — chat UI, WebSocket streaming, tool rendering |
| [claude-agent-runner](https://github.com/DigiBugCat/claude-agent-runner) | Multi-session agent orchestrator + Docker/k8s runner |
| `cassandra-yt-mcp` | YouTube MCP rewrite — private backend API, public Worker edge, service-owned Terraform modules |
| [cassandra-k8s](https://github.com/DigiBugCat/cassandra-k8s) | Helm charts, ArgoCD apps, Sealed Secrets |
| [cassandra-infra](https://github.com/DigiBugCat/cassandra-infra) | Terraform — Cloudflare tunnels, DNS, WAF |
