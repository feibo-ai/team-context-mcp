# team-context-mcp

MCP server enforcing AI MIQ SOP v0.4 workflow over multica + git.

## Tools

| Tool | Purpose |
| --- | --- |
| `plan_create` | Generate plan markdown + multica plan-draft issue |
| `plan_request_review` | Request review from a second session |
| `plan_approve` | The SOP non-negotiable #1 gate |
| `session_handoff` | Pre-clear handoff: commit WIP + update plan |
| `case_create` | Generate debrief case file (5 mandatory sections) |
| `case_promote_rule` | Promote rule from case to CLAUDE.md |
| `skill_lint` | Token + owner + staleness checks |
| `monthly_health_report` | SOP-aligned monthly health snapshot |

## Install

See [INSTALL.md](./INSTALL.md).

## Sister project

[team-context](../team-context) — git repo of shared SOP, Skills, standards.
