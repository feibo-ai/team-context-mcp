# team-context-mcp v0.3.0 (remote-only · control plane edition)

Single remote MCP server enforcing AI MIQ SOP v0.4 broadcast / DM / Wiki / METR-decision
tooling over multica + Feishu.

- **`@tcmcp/remote`** — 10 tools · HTTP/SSE at `mcp.teamctx.actionow.ai/mcp` · runs on Zeabur (project `teamctx`) · pulls config + secrets from a multica `mcp-server` integration (live, reactive to rotation)

> **0.3.0 — `@tcmcp/local` removed (iteration 2).** The 13 former local stdio tools (the RPI
> doc flow: plan/research/case/handoff generation + inline render) moved to team-context
> `skills/tc-render/publish.py` + the `multica` CLI (`skill pull` / `skill lint` /
> `issue comment add --inline`). Only `@tcmcp/local` was removed; `@tcmcp/remote` stays.
> Replacement map below. Rationale:
> [decisions/2026-06-08-drop-local-mcp.md](../team-context/decisions/2026-06-08-drop-local-mcp.md).

## Architecture

```
+--------------------+       HTTP/SSE        +---------------------+
|  Claude / Codex    | --------------------> |  @tcmcp/remote      |
|  (any team member) |  Bearer <multica jwt> |  Zeabur · teamctx   |
+--------------------+                       |  - per-user auth    |
                                             |    (M-16, /api/me)  |
                                             |  - /health (M-17)   |
                                             |  - DeploymentTracker|
                                             |    (M-18)           |
                                             +----------+----------+
                                                        | REST + WS
                                                        v
                                             +---------------------+
                                             |  multica server     |
                                             |  · integrations     |
                                             |  · secrets (AES)    |
                                             |  · audit_logs       |
                                             |  · WS broadcast     |
                                             +---------+-----------+
                                                       |
                                                       v
                                             +---------------------+
                                             |  Feishu open API    |
                                             |  (chats / wiki /docx|
                                             |   im.message.*)     |
                                             +---------------------+
```

`@tcmcp/remote` boots by calling `MulticaConfigSource.start()` against `MULTICA_URL`. Config + secrets stream over WS (poll fallback). On rotation, every `FeishuClient` request rebuilds the lark SDK against the new `APP_SECRET` — no restart needed. If multica's control plane is off (404), the server falls back to env-only mode and `/health` reports `controlPlaneOk=false` honestly.

## Tools

### Remote (10 · HTTP/SSE · need Feishu + workspace-wide reach)

| Tool | Purpose |
| --- | --- |
| `plan_request_review` | Label plan under-review + post reviewer prompt to team chat. |
| `betting_table_capture` | Friday betting-table issue (open / close / vote tally). |
| `burnout_check_distribute` | Monthly anonymous burnout survey · distribute (P2P) + collect (read DMs). |
| `should_i_use_ai` | METR factor model — use-ai / write-directly / borderline. |
| `code_review_request` | ❌1 self-review prevention — assigns a different reviewer agent + label. |
| `notify_team` | Send text or interactive card to the team Feishu chat. |
| `dm_member` | Send a P2P direct message to a member by email. |
| `archive_to_wiki` | Import a local markdown file as a Feishu docx + link under a wiki node. |
| `search_chat` | Search Feishu workspace chats (maintenance helper). |
| `read_member_dm` | Read recent P2P history for one team member (used by burnout collect). |

The exact list is authoritative in `packages/remote/src/server.ts` `buildToolDefs()`.

### Removed in 0.3.0 — replacement map (former `@tcmcp/local`, 13 tools)

The local stdio server was deleted (`#17`/`#18`). Its RPI doc-flow tools moved to
team-context skills + the `multica` CLI — there is nothing to install for these:

| 旧 local 工具 | 新替代 |
| --- | --- |
| `doc_publish` / `plan_create` / `research_create` / `case_create` / `session_handoff` / `plan_upgrade` | team-context `skills/tc-render/publish.py`（render + 硬校验 + 命门A 内联发布）；命门B = `multica issue comment add --inline` |
| `skill_lint` | `multica skill lint` |
| skill 自更新 | `multica skill pull` |
| `plan_approve` / `case_review` | skill 调 `multica` CLI（issue label / status） |
| `project_kickoff` | `tc-1-start` skill |
| `case_promote_rule` | `tc-5-review` prose |
| `monthly_health_report` / `autopilot_lint` | `tc-ops` 脚本 |

> **Doc model:** plan / research / case docs are uploaded + posted as append-only issue
> **comments** (`!file` inline render) by `tc-render` `publish.py`, never the issue description
> (attachments are immutable · the CLI can't re-upload). Updates are new comments. Every issue
> lives under a project.

## Install · Deploy

- **Team members** — see [INSTALL.md](./INSTALL.md). No local build: point your MCP client at the always-on remote `https://mcp.teamctx.actionow.ai/mcp`.
- **Operating the remote** — see [DEPLOY.md](./DEPLOY.md). `@tcmcp/remote` runs on Zeabur with CD on push to `main` (Zeabur builds the Dockerfile); Feishu secret rotation is reactive — no redeploy.

## Smoke

See [SMOKE.md](./SMOKE.md). Round-trips cover `tools/list` (10 remote tools) and one Feishu-touching tool (`notify_team`).

## Sister project

[team-context](../team-context) — git repo of shared SOP, Skills, standards, and the autopilots that consume these tools.
