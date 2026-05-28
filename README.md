# team-context-mcp

MCP server enforcing AI MIQ SOP v0.4 workflow over multica + git.

## Tools (17 total · 4 groups)

### Gate · 守门 6（SOP 非妥协 #1 #2）
| Tool | Purpose |
| --- | --- |
| `plan_create` | Generate plan markdown + multica plan-draft issue |
| `plan_request_review` | Request review from a second session |
| `plan_approve` | The SOP non-negotiable #1 gate |
| `plan_upgrade` | Bump plan version (v1.x) + snapshot + re-review |
| `case_create` | Generate debrief case file (5 mandatory sections) |
| `case_promote_rule` | Promote rule from case to CLAUDE.md |

### Sync · 协作 4（节奏 + 启动 + 收口）
| Tool | Purpose |
| --- | --- |
| `session_handoff` | Pre-clear handoff: commit WIP + update plan ## Current State |
| `project_kickoff` | Phase 01 6-step orchestration (research + plan + multica project + broadcast) |
| `betting_table_capture` | Friday betting table (open / close / vote tally, no backlog) |
| `burnout_check_distribute` | Monthly anonymous burnout survey (distribute / collect via feishu-cli P2P) |

### Observe · 健康度 2（月度 review）
| Tool | Purpose |
| --- | --- |
| `skill_lint` | Token + owner + 90-day staleness checks |
| `monthly_health_report` | SOP-aligned monthly health snapshot + ancient-impossible label tally |

### Safety · 红线 5（PB-04 + ❌1 + ❌8 + Section 4 + RPI）
| Tool | Purpose |
| --- | --- |
| `autopilot_lint` | PB-04 guardrails + budget cap enforcement (apply-autopilots.sh pre-check) |
| `case_review` | Section 4 review gate — refuses trivial Key judgments, signs + labels |
| `should_i_use_ai` | ❌8 red-line guard — METR factor model (experience + familiarity + size) |
| `code_review_request` | ❌1 self-review prevention — assigns a different reviewer agent |
| `research_create` | RPI Research session skeleton at docs/research/ |

## Install

See [INSTALL.md](./INSTALL.md).

## Sister project

[team-context](../team-context) — git repo of shared SOP, Skills, standards.
