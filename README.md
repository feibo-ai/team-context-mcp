# team-context-mcp v0.2 (control plane edition)

> ⚠️ **DEPRECATED — @tcmcp/local 迭代2 整包删除**。RPI 文档流（plan/research/case/handoff 生成+内联渲染）已迁至 team-context `skills/tc-render/publish.py` + `multica` CLI（`skill pull`/`skill lint`/`issue comment add --inline`）。本包仅 @tcmcp/local 删除；@tcmcp/remote 保留。

Hybrid MCP server pair enforcing AI MIQ SOP v0.4 workflow over multica + git + Feishu.

- **`@tcmcp/remote`** — 10 tools · HTTP/SSE at `mcp.teamctx.actionow.ai/mcp` · runs on Zeabur (project `teamctx`) · pulls config + secrets from a multica `mcp-server` integration (live, reactive to rotation)
- **`@tcmcp/local`** — 13 tools · stdio · spawned by Claude Code / Codex CLI inside the user's repo checkout · git + file ops only

23 tools total. Architecture is hybrid because some SOP gates (`plan_create`, `case_create`, `session_handoff` …) need access to the user's working tree and `git`, while broadcast / DM / Wiki / METR-decision tools have no local dependency and benefit from a single server-side process owning Feishu tokens.

## Architecture

```
+--------------------+       HTTP/SSE        +---------------------+
|  Claude / Codex    | --------------------> |  @tcmcp/remote      |
|  (any team member) |  Bearer <multica jwt> |  Zeabur · teamctx   |
+--------------------+                       |                     |
        |                                    |  - per-user auth    |
        | stdio                              |    (M-16, /api/me)  |
        v                                    |  - /health (M-17)   |
+--------------------+                       |  - DeploymentTracker|
|  @tcmcp/local      |                       |    (M-18)           |
|  (per-checkout)    |                       +----------+----------+
+--------------------+                                  |
        |                                               | REST + WS
        | calls multica/api/* with member's own         v
        | bearer (same token)                +---------------------+
        +----------------------------------> |  multica server     |
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

### Local (13 · stdio · need git + filesystem)

> ⚠️ **DEPRECATED · 迭代2 整包删除 — replacement map**（下表 13 工具均不再用，改走 team-context skills + `multica` CLI）：
>
> | 旧 local 工具 | 新替代 |
> | --- | --- |
> | `doc_publish` / `plan_create` / `research_create` / `case_create` / `session_handoff` / `plan_upgrade` | team-context `skills/tc-render/publish.py`（render + 硬校验 + 命门A 内联发布）；命门B = `multica issue comment add --inline` |
> | `skill_lint` | `multica skill lint` |
> | skill 自更新 | `multica skill pull` |
> | `plan_approve` / `case_review` | skill 调 `multica` CLI（issue label / status） |
> | `project_kickoff` | `tc-1-start` skill |
> | `case_promote_rule` | `tc-5-review` prose |
> | `monthly_health_report` / `autopilot_lint` | `tc-ops` 脚本 |

Gate · 守门 6 (SOP non-negotiable #1 #2):

| Tool | Purpose |
| --- | --- |
| `plan_create` | Generate plan HTML doc + multica plan-draft issue (doc → issue **comment** · requires `projectId`). |
| `plan_approve` | The SOP non-negotiable #1 gate. |
| `plan_upgrade` | Bump plan version (v1.x) + snapshot + re-review. |
| `case_create` | Generate debrief case file (5 mandatory sections) + 复盘 issue (doc → **comment** · requires `projectId`). |
| `case_review` | Section 4 review gate — refuses trivial Key judgments, signs + labels. |
| `case_promote_rule` | Promote a rule from a case file to CLAUDE.md. |

Sync · 协作 2 (handoff + kickoff):

| Tool | Purpose |
| --- | --- |
| `session_handoff` | Pre-clear handoff — commit WIP + update plan `## Current State`. |
| `project_kickoff` | Phase 01 6-step orchestration (research + plan + project + broadcast hint). |

Observe · 健康度 2 (monthly review):

| Tool | Purpose |
| --- | --- |
| `skill_lint` | Token + owner + 90-day staleness checks. |
| `monthly_health_report` | SOP-aligned monthly health snapshot. |

Safety · 红线 + RPI/doc · 3:

| Tool | Purpose |
| --- | --- |
| `autopilot_lint` | PB-04 guardrails + budget cap enforcement. |
| `research_create` | RPI Research session skeleton at `docs/research/` (creates issue + local skeleton · requires `projectId`). |
| `doc_publish` | Publish a local HTML doc to an issue as an append-only **comment** (`!file` inline render) — fills a research skeleton or posts any new doc version. |

> **Doc model:** plan / research / case docs are uploaded + posted as append-only issue **comments** (`!file` inline render), never the issue description (attachments are immutable · the CLI can't re-upload). Updates are new comments (`plan_upgrade`, `doc_publish`). Create tools require `projectId` — **every issue lives under a project**.

> Drift note: Plan-5 quoted "21 = 9 remote + 12 local". M-12 added `read_member_dm` (remote → 10, total 22); later `doc_publish` added (local → **13**, total **23**). Both servers' `tools/list` agree.

## Install · Deploy

- **Team members** — see [INSTALL.md](./INSTALL.md). Install only `@tcmcp/local` and point your MCP client at the always-on remote `https://mcp.teamctx.actionow.ai/mcp`.
- **Operating the remote** — see [DEPLOY.md](./DEPLOY.md). `@tcmcp/remote` runs on Zeabur with CD on push to `main` (Zeabur builds the Dockerfile); Feishu secret rotation is reactive — no redeploy.

## Smoke

See [SMOKE.md](./SMOKE.md). 5 round-trips cover `tools/list` on both transports and one tool per phase (gate / sync / observe / safety / remote-Feishu).

## Sister project

[team-context](../team-context) — git repo of shared SOP, Skills, standards, and the autopilots that consume these tools.
