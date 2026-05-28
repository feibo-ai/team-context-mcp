# SMOKE — end-to-end MCP round-trips

Verified 2026-05-27 against the built `dist/server.js` over stdio (MCP protocol 2024-11-05).

## Round-trip 1 — initialize + tools/list

Probe:
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

Result: **17 tools** listed. Names exactly:

```
plan_create, plan_request_review, plan_approve, session_handoff,
case_create, case_promote_rule, skill_lint, monthly_health_report,
plan_upgrade, project_kickoff, betting_table_capture,
burnout_check_distribute, autopilot_lint, case_review,
should_i_use_ai, code_review_request, research_create
```

## Round-trip 2 — `plan_create` via vitest

`tests/tools/plan_create.test.ts` mocks the multica REST endpoint and asserts:
- plan markdown written at `docs/plans/plan_YYYY-MM-DD_<slug>.md`
- multica issue id returned
- DRI + Goal + Completion criteria embedded in body

Result: PASS (158ms).

## Round-trip 3 — `session_handoff` via vitest

Asserts:
- `git add -A && git commit` invoked through simple-git wrapper
- Plan's `## Current State` section upserted with handoff block

Result: PASS (344ms).

## Round-trip 4 — `autopilot_lint` via vitest (PB-04 gate)

Fed 2 fixture YAMLs:
- `autopilot-ok.yaml` → reports clean (forbidden_commands ≥ 5 + `git push` present + budget ≤ 150)
- `autopilot-missing-guardrails.yaml` → reports failure with the offending field

Plus inline cases: missing `git push`, budget > 150.

Result: 4/4 PASS.

## Round-trip 5 — `case_review` (the section-4 gate)

Asserts:
- Trivial section 4 → throws `section 4 ... too short`
- Substantive section 4 → appends `Reviewed by: <email>` + adds `debrief-reviewed` label

Result: 2/2 PASS.

## Aggregate

```
Test Files  23 passed (23)
Tests       45 passed (45)
```

`tsc --noEmit` clean. `pnpm build` produces `dist/server.js`.

## What's NOT covered here

- **Real multica server roundtrip** — all tests use undici MockAgent. The integration-level smoke (real `multica skill import` and `multica autopilot apply`) is covered by `team-context/standards/multica-sync-results.md`.
- **Real feishu push** — the autopilot bots cover the feishu side; this MCP server's role is to provide the protocol tools, not push messages.
- **GUI session manual test** — second human (any team member opening Claude Code with this MCP wired) should ask "What tools do you have from team-context-mcp?" and see 17.
