# SMOKE — end-to-end MCP round-trips (v0.3.0 · remote-only)

Verified against the v0.3.0 remote-only build: `@tcmcp/remote` over HTTP/SSE on `:8443/mcp`.
MCP protocol version `2024-11-05`.

> **0.3.0 note:** `@tcmcp/local` (the 13 stdio doc-flow tools) was removed — its round-trips
> (former 1b / 2 / 4 / 5) are gone. Those flows now live in team-context skills + the `multica`
> CLI; their smoke coverage is `team-context/standards/multica-sync-results.md`. The two
> round-trips below cover the remote server: `tools/list` + one Feishu-touching tool.

## Round-trip 1 — `tools/list` (remote · HTTP/SSE)

```bash
curl -sN -X POST http://localhost:8443/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MULTICA_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}'

curl -sN -X POST http://localhost:8443/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MULTICA_TOKEN" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}'

curl -sN -X POST http://localhost:8443/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MULTICA_TOKEN" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

Result: **10 tools** listed. Names exactly:

```
plan_request_review, betting_table_capture, burnout_check_distribute,
should_i_use_ai, code_review_request,
notify_team, dm_member, archive_to_wiki, search_chat, read_member_dm
```

Without the `Authorization` header, the same request returns `401` from
`createAuthMiddleware` (M-16). With a token that doesn't validate against
`/api/me`, also `401`. Cached for 5 min per token.

## Round-trip 2 — `notify_team` (remote · Feishu)

`packages/remote/tests/tools/notify_team.test.ts` mocks `FeishuClient.send*`
and asserts:

- `feishu_team_chat_id` is read from `ConfigSource.get()` (not env)
- text mode → `im.message.create` with `msg_type=text`
- card mode → `im.message.create` with `msg_type=interactive` and the card body
- returns `{ messageId, chatId }`

Result: PASS. Verifies the config-source → Feishu path that is the whole
reason `@tcmcp/remote` exists.

## Aggregate

```bash
pnpm -r test
# test files across packages/{config,feishu,shared,remote}
```

`tsc --noEmit` clean across all packages. `pnpm -r build` produces
`packages/remote/dist/server.js`.

## Audit log integration

- Every secret first-fetch and post-cache-miss fetch writes one `audit_logs`
  row on the multica side (Plan-4 D-15: `event_type=secret:read`,
  `resource=secret:<integration_id>:<key>`).
- 5-min cache hits do **not** write an audit row (intentional perf / noise
  trade-off — see comment in `packages/config/src/multica.ts` `getSecret()`).
- For every-call audit fidelity (compliance review), boot the remote container
  with `secretCacheTtlMs: 0` on `MulticaConfigSource` — the option is plumbed
  via the constructor today; an env override is on the M-25+ list. Until then
  the relevant call site is `packages/remote/src/server.ts` `main()`.
- Monthly DRI review:

  ```bash
  multica audit-log list --resource "secret:<integration_id>:*" --since 30d
  ```

  Expected cadence: ~1 row per (key × container restart) plus 1 row per
  rotation, not per Feishu call.

## What's NOT covered here

- **Real Feishu push** — `notify_team` / `dm_member` / `archive_to_wiki` /
  `search_chat` / `read_member_dm` are exercised against `FeishuClient` mocks.
  End-to-end Feishu hits are deferred to Task M-24 (DRI runs once on the
  staging chat after `docker compose up`).
- **Per-user RBAC granularity** — M-16 auth is bearer-token validation against
  `/api/me`. Anyone with a valid workspace member token can call any remote
  tool; per-tool authorization is not in v0.3.0.
- **RPI doc-flow tools** (former `@tcmcp/local`) — now skills + `multica` CLI;
  their integration smoke lives in `team-context/standards/multica-sync-results.md`.
- **GUI session manual test** — a second human (any team member opening Claude
  Code wired to the DRI's URL) should ask "What tools do you have from
  `tcmcp-remote`?" and see 10.
