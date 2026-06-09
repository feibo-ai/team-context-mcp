# SMOKE — end-to-end MCP round-trips (v0.2)

> ⚠️ **DEPRECATED 提示 — local 13 工具迭代2 删除。** 本文档中凡涉及 `@tcmcp/local` 的 13 工具与 "23 tools" 基线的部分（Round-trip 1b / 2 / 4 / 5、Aggregate、What's NOT covered 的 local 行）**仅作历史记录**：这些工具已迁至 team-context skills + `multica` CLI，迭代2 随整包删除。`@tcmcp/remote`（10 工具）部分仍然有效保留。

Verified against the v0.2 hybrid build: `@tcmcp/remote` over HTTP/SSE on `:8443/mcp`
and `@tcmcp/local` over stdio. MCP protocol version `2024-11-05`.

The 5 round-trips below cover both transports and pick one tool from each phase
(gate / sync / observe / safety) plus one Feishu-touching remote tool.

## Round-trip 1 — `tools/list` on both transports

### 1a · Remote (HTTP/SSE)

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

### 1b · Local (stdio)

Pipe the same three frames into `node packages/local/dist/server.js`:

```bash
(
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
) | node packages/local/dist/server.js
```

Result: **13 tools** listed. Names exactly:

```
plan_create, plan_approve, plan_upgrade,
case_create, case_review, case_promote_rule,
session_handoff, project_kickoff, research_create,
doc_publish, skill_lint, monthly_health_report, autopilot_lint
```

> ⚠️ **DEPRECATED — 这 13 个 local 工具迭代2 删除，本节 local 部分仅历史。** 替代见 README 的 replacement map（tc-render `publish.py` / `multica skill lint` / `multica skill pull` / `multica issue comment add --inline` / tc-1-start / tc-5-review / tc-ops）。

Combined: **23 tools** across both servers — what the user should see in
Claude Code's "tools" picker（**注：23 = 10 remote + 13 local；迭代2 后 local 13 删除，只剩 remote 10**）.

## Round-trip 2 — `plan_create` (local · gate phase)

`packages/local/tests/tools/plan_create.test.ts` mocks the multica REST endpoint
and asserts:

- plan markdown written at `docs/plans/plan_YYYY-MM-DD_<slug>.md`
- multica issue id returned
- DRI + Goal + Completion criteria embedded in body

Result: PASS.

## Round-trip 3 — `notify_team` (remote · Feishu)

`packages/remote/tests/tools/notify_team.test.ts` mocks `FeishuClient.send*`
and asserts:

- `feishu_team_chat_id` is read from `ConfigSource.get()` (not env)
- text mode → `im.message.create` with `msg_type=text`
- card mode → `im.message.create` with `msg_type=interactive` and the card body
- returns `{ messageId, chatId }`

Result: PASS. Verifies the config-source → Feishu path that is the whole
reason `@tcmcp/remote` exists.

## Round-trip 4 — `autopilot_lint` (local · safety / PB-04 gate)

`packages/local/tests/tools/autopilot_lint.test.ts` feeds fixture YAMLs:

- `autopilot-ok.yaml` → reports clean (forbidden_commands ≥ 5 + `git push` present + budget ≤ 150)
- `autopilot-missing-guardrails.yaml` → reports failure with the offending field
- inline cases: missing `git push`, budget > 150

Result: PASS.

## Round-trip 5 — `case_review` (local · the Section-4 gate)

`packages/local/tests/tools/case_review.test.ts` asserts:

- trivial Section 4 → throws `section 4 ... too short`
- substantive Section 4 → appends `Reviewed by: <email>` + adds `debrief-reviewed` label

Result: PASS.

## Aggregate

```
pnpm -r test
# ~ 38 test files across packages/{config,feishu,shared,remote,local}
```

`tsc --noEmit` clean across all six packages. `pnpm -r build` produces
`packages/remote/dist/server.js` and `packages/local/dist/server.js`.

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

- **Real multica server round-trip** for the local 13 tools — all tests use
  undici MockAgent. Integration smoke for `multica skill import` /
  `multica autopilot apply` lives in `team-context/standards/multica-sync-results.md`.
- **Real Feishu push** — `notify_team` / `dm_member` / `archive_to_wiki` /
  `search_chat` / `read_member_dm` are exercised against `FeishuClient` mocks.
  End-to-end Feishu hits are deferred to Task M-24 (DRI runs once on the
  staging chat after `docker compose up`).
- **Per-user RBAC granularity** — M-16 auth is bearer-token validation against
  `/api/me`. Anyone with a valid workspace member token can call any remote
  tool; per-tool authorization is not in v0.2.
- **GUI session manual test** — a second human (any team member opening Claude
  Code wired to the DRI's URL) should ask "What tools do you have from
  tcmcp-remote and tcmcp-local?" and see 23 across the two servers.
