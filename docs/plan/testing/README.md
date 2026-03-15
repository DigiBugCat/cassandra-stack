# Repo Testing Plans

This folder holds the per-repo testing plan for the stack.

The goal is to make the testing shape explicit for each subrepo:

- what is already covered
- what kind of tests we should add next
- what should be validated but probably not "tested" in the usual sense
- what does not make sense to invest in

## Indicators

- `[have]` already exists or is already the right long-term shape
- `[next]` high-value test or validation work we should add
- `[later]` useful, but lower priority than the `next` items
- `[validate]` should be checked by linting, typechecking, rendering, or plans rather than classic tests
- `[skip]` not worth building a dedicated automated test harness right now

## Application Repos

- [claude-agent-runner.md](/Users/andrew.sulistio/cassandra-stack/docs/plan/testing/claude-agent-runner.md)
- [cassandra-obsidian.md](/Users/andrew.sulistio/cassandra-stack/docs/plan/testing/cassandra-obsidian.md)
- [cassandra-auth.md](/Users/andrew.sulistio/cassandra-stack/docs/plan/testing/cassandra-mcp-auth.md)
- [cassandra-portal.md](/Users/andrew.sulistio/cassandra-stack/docs/plan/testing/cassandra-portal.md)
- [cassandra-observability.md](/Users/andrew.sulistio/cassandra-stack/docs/plan/testing/cassandra-observability.md)
- [cassandra-yt-mcp-worker.md](/Users/andrew.sulistio/cassandra-stack/docs/plan/testing/cassandra-yt-mcp-worker.md)
- [cassandra-yt-mcp-backend.md](/Users/andrew.sulistio/cassandra-stack/docs/plan/testing/cassandra-yt-mcp-backend.md)

## Infra Repos

- [cassandra-k8s.md](/Users/andrew.sulistio/cassandra-stack/docs/plan/testing/cassandra-k8s.md)
- [cassandra-infra.md](/Users/andrew.sulistio/cassandra-stack/docs/plan/testing/cassandra-infra.md)
