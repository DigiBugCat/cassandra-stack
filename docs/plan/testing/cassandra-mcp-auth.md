# cassandra-mcp-auth Testing Plan

## Repo Type

Shared application library for auth and worker wiring. Two implementations: TypeScript (CF Workers) and Python (FastMCP servers). Both should have automated tests at the helper and contract level.

## Current Shape

### TypeScript (CF Workers)
- `[have]` typecheck exists
- `[have]` Vitest unit suite covers token resolution, JWT verification, OAuth state/session helpers, and WorkOS utility contracts
- `[have]` integration smoke coverage exercises the WorkOS auth handler and `createMcpWorker()` route/metrics wiring
- `[have]` coverage command exists

### Python (FastMCP servers)
- `[have]` pytest suite (13 tests) covering McpKeyAuthProvider and Enforcer
- `[have]` tests cover key validation, service scoping, ACL enforcement, deny-wins semantics, domain/group inheritance

## What We Should Test

- `[have]` token resolution for `mcp_` API keys from KV (TypeScript)
- `[have]` WorkOS JWT verification behavior with mocked JWKS responses (TypeScript)
- `[have]` OAuth state creation, binding, and validation helpers (TypeScript)
- `[have]` `createMcpWorker()` smoke coverage around metrics and route wiring (TypeScript)
- `[have]` McpKeyAuthProvider validates keys via ACL `/keys/validate` endpoint (Python)
- `[have]` Enforcer loads YAML policy and enforces user/group/domain ACL with deny-wins (Python)
- `[later]` richer unhappy-path handler coverage for WorkOS exchange failures and OAuth provider rejections

## What We Should Validate Instead

- `[validate]` compatibility with the Workers runtime and MCP SDK versions through typecheck and build verification

## What Not To Overinvest In

- `[skip]` full browser-driven OAuth end-to-end tests inside this repo alone

## Command Shape

- `bootstrap`: `npm install`
- `static`: `npm run type-check`
- `unit`: `npm run test:unit`
- `integration`: `npm run test:integration`
- `coverage`: `npm run test:coverage`
