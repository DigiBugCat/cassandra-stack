---
name: svc-auth
description: Work with cassandra-auth — the shared auth library (TS + Python) and ACL CF Worker. Use when modifying auth, ACL policies, MCP key validation, per-user credentials, or the enforcer.
---

# Working with cassandra-auth

Read `cassandra-auth/AGENTS.md` first for full architecture. This skill covers common dev tasks.

## Repo Location
`cassandra-stack/cassandra-auth/`

## Three Components

| Component | Path | Language | What it is |
|-----------|------|----------|------------|
| TS package | `src/` | TypeScript | Shared lib consumed by CF Workers via `createMcpWorker()` |
| Python package | `python/` | Python | `cassandra-mcp-auth` — FastMCP sidecar auth + ACL |
| ACL Worker | `worker/` | TypeScript | CF Worker — `/check`, `/keys/validate`, `/credentials` |

## Dev Commands

```bash
# TypeScript tests
cd cassandra-auth && npm test

# Python package
cd cassandra-auth/python && uv run pytest -v

# Type check worker
cd cassandra-auth/worker && npx tsc --noEmit

# Manual worker deploy
cd cassandra-auth/worker && npx wrangler deploy
```

## Common Tasks

### Add a new MCP service to ACL
1. Edit `env/acl.yaml` — add group/user policies for the service
2. Push cassandra-auth to main (Woodpecker redeploys with new YAML from secret)
3. Or: update the `acl_yaml` Woodpecker secret, then push any change to trigger rebuild

### Add per-user credentials for a service
```bash
curl -X POST https://auth.cassandrasedge.com/credentials/<email>/<service> \
  -H 'X-Auth-Secret: <secret>' \
  -H 'Content-Type: application/json' \
  -d '{"api_key": "...", "other": "..."}'
```

### Test ACL check locally
```bash
curl -X POST https://auth.cassandrasedge.com/check \
  -H 'X-Auth-Secret: <secret>' \
  -H 'Content-Type: application/json' \
  -d '{"email": "andrew@raftesalo.net", "service": "yt-mcp", "tool": "transcribe"}'
```

### Update TS package consumed by Workers
After changing `src/`, Workers pull the latest via `npm update cassandra-mcp-auth` (or `github:Cassandras-Edge/cassandra-auth` ref in their package.json).

### Update Python package
After changing `python/`, FastMCP services pull via `cassandra-mcp-auth` pip dependency pointing to the repo.

## Gotchas
- TS enforcer (`worker/src/enforcer.ts`) and Python enforcer (`python/src/cassandra_mcp_auth/acl.py`) must stay in sync — same policy evaluation logic
- ACL policy is baked at build time from `env/acl.yaml` — changes need a redeploy
- Portal ACL migration (planned) will move policy to KV for runtime edits
