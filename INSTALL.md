# Install · v0.3.0 (remote-only · `@tcmcp/remote` on Zeabur)

The remote server is already deployed on Zeabur — see [DEPLOY.md](./DEPLOY.md) for how
it's built and operated. Team members only do the **light path** below: point your MCP
client at the always-on remote URL. **There is nothing to build or run locally.**

> **0.3.0 — `@tcmcp/local` removed (breaking).** The 13 former local stdio tools
> (plan/research/case/handoff/skill_lint …) moved out of this repo: the RPI doc flow now
> runs on team-context **skills + the `multica` CLI**. Pull skills with `multica skill pull --all`;
> doc generation + inline publish goes through `skills/tc-render/publish.py`
> (命门B = `multica issue comment add --inline`); skill lint is `multica skill lint`.
> **This repo now ships only `@tcmcp/remote` (10 Feishu/SOP-broadcast tools).** Rationale:
> [decisions/2026-06-08-drop-local-mcp.md](../team-context/decisions/2026-06-08-drop-local-mcp.md).

---

## Team members (most people · light path)

You wire one always-on remote server into your client. **No clone, no build.** The remote
is running at `https://mcp.teamctx.actionow.ai`.

Two values you provide yourself:
- **Remote MCP URL** — `https://mcp.teamctx.actionow.ai/mcp`
- **Your personal multica bearer token** — the same token the multica CLI uses;
  run `multica login`, then copy the `token` field from `~/.multica/config.json`

### 1. Wire the remote server into Claude Code

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on Windows/Linux:

```json
{
  "mcpServers": {
    "tcmcp-remote": {
      "url": "https://mcp.teamctx.actionow.ai/mcp",
      "headers": { "Authorization": "Bearer <your-multica-token>" }
    }
  }
}
```

Replace `<your-multica-token>` with your value. Failing to reach the remote server disables
the 10 Feishu/SOP-broadcast tools (you'll see them missing from `tools/list`).

### 2. Wire into Codex CLI (optional)

```bash
codex mcp add-http tcmcp-remote https://mcp.teamctx.actionow.ai/mcp \
  --header "Authorization: Bearer <your-multica-token>"
```

### 3. Get the RPI doc-flow tools (formerly `@tcmcp/local`)

The plan / research / case / handoff flow is no longer an MCP server — it lives in
team-context skills + the `multica` CLI:

```bash
multica skill pull --all     # pull the tc-* skills into ~/.claude/skills
```

Doc generation + inline publish runs through `skills/tc-render/publish.py`; skill lint is
`multica skill lint`. See [team-context](../team-context) for the skills themselves.

### 4. Verify

Restart Claude Code / Codex. Ask "What tools do you have from `tcmcp-remote`?"

Expected: **10 tools** from `tcmcp-remote`. See [README.md](./README.md) for the breakdown.

---

## multica-side configuration (one-time · operator)

The remote on Zeabur reads its config + Feishu secrets from a multica `mcp-server`
integration. These preconditions must hold on the multica server (`multica-backend`),
independent of where the remote runs. Deploy mechanics live in [DEPLOY.md](./DEPLOY.md);
this section is the multica setup the deploy depends on.

### Pre-flight · multica side

Boot will **fail or silently degrade** unless these three hold:

1. **Control plane enabled.** multica server `.env` must include `MULTICA_CONTROL_PLANE_ENABLED=true`.
   Otherwise `/api/integrations/*` routes return 404 and `MulticaConfigSource.start()` throws a
   `control plane disabled` error on boot — this is intentional (see `packages/config/src/multica.ts`
   `start()`). The remote then falls back to env-only mode and `/health` reports
   `multica_control_plane_enabled: false`.
2. **Secret master key set.** multica server `.env` must include a base64-encoded 32-byte
   `MULTICA_SECRET_MASTER_KEY`. Without it `multica secret set` errors out at the CLI before
   anything reaches the wire.
3. **Integration + secrets pushed.** The manual steps below.

### Pre-flight · service token capability

The `MULTICA_SERVICE_TOKEN` set on the Zeabur service must belong to a user with
**workspace admin or owner role** — otherwise secret reads return 403 and
`FeishuClient.ensureSdk()` fails on every remote tool call:

| Endpoint                                   | Member role                       | Admin / Owner |
| ------------------------------------------ | --------------------------------- | ------------- |
| `GET /api/integrations/{id}`               | 200 (non-secret config readable)  | 200           |
| `GET /api/integrations/{id}/secrets/{key}` | **403**                           | 200           |
| → FeishuClient `ensureSdk()` rebuild       | **fails (no APP_SECRET)**         | works         |

Verify the token can read a secret (run from a machine with the multica CLI configured):

```bash
INT_ID=$(multica integration list --kind mcp-server --output json \
         | jq -r '.[] | select(.name=="team-context-mcp") | .id')

curl -H "Authorization: Bearer $MULTICA_SERVICE_TOKEN" \
     -H "X-Workspace-Id: $MULTICA_WORKSPACE_ID" \
     "https://api.teamctx.actionow.ai/api/integrations/$INT_ID/secrets/FEISHU_APP_ID"
# Expect: 200 with JSON · NOT 403
```

If you see 403, switch the service token to an admin/owner user (and update the Zeabur var — see DEPLOY.md).

### 1. Create the multica integration (one time)

```bash
multica integration create \
  --kind mcp-server \
  --name team-context-mcp \
  --config '{"feishu_team_chat_id":"oc_xxx","feishu_wiki_space_id":"wikcn..."}'
```

`feishu_team_chat_id` is where `notify_team` posts. `feishu_wiki_space_id` is the parent space
for `archive_to_wiki`. Both are non-secret config (readable by every workspace member).

### 2. Set secrets (token must be admin — see Pre-flight above)

```bash
echo -n "$FEISHU_APP_ID"     | multica secret set --integration team-context-mcp FEISHU_APP_ID     --value-stdin
echo -n "$FEISHU_APP_SECRET" | multica secret set --integration team-context-mcp FEISHU_APP_SECRET --value-stdin
```

Rotation is reactive — push a new secret and the running container picks it up via WS within
a heartbeat. No redeploy.

### 3. Confirm the remote is healthy

```bash
curl -s https://mcp.teamctx.actionow.ai/health | jq .
```

Expected `/health` JSON (real shape — fields match `HealthResponse` in `packages/remote/src/health.ts`):

```json
{
  "status": "healthy",
  "version": "2a91a88",
  "uptime_seconds": 42.7,
  "config_version": 2,
  "config_source": "LayeredConfigSource",
  "multica_control_plane_enabled": true,
  "multica_reachable": true,
  "feishu_ready": true,
  "deployment": {
    "registered": true,
    "deployment_id": "dep_xxx",
    "beats_succeeded": 3,
    "beats_failed": 0
  }
}
```

### Health field semantics

- `status` rolls up to `"degraded"` iff `multica_reachable` is `false`. Feishu unready does NOT degrade (it's a downstream side-effect, not a request-path dep).
- `version` is the live git commit (from `ZEABUR_GIT_COMMIT_SHA`, injected by Zeabur; `unknown` only when run off-platform).
- `config_source` is `"MulticaConfigSource"` when only the control plane is wired, `"EnvConfigSource"` when falling back to env, `"LayeredConfigSource"` when both are stacked (the normal Zeabur state).
- `multica_control_plane_enabled` is set after `MulticaConfigSource.start()` resolves; `false` means first pull threw 404 (server-side `MULTICA_CONTROL_PLANE_ENABLED=false` or integration row missing).
- `deployment` block appears only when the integration is resolved and `DeploymentTracker` is wired; absent means env-only mode.

If `multica_control_plane_enabled` is `false`: revisit the Pre-flight section. If `feishu_ready` is `false`: your service token can't read the secret — see the capability table.

### 4. Share with the team

```bash
multica issue create \
  --project <project-uuid> \
  --title "tcmcp-remote is live · v0.3.0" \
  --description "URL: https://mcp.teamctx.actionow.ai/mcp · Each member runs \`multica login\` for their bearer · See INSTALL.md team-member path (no local build)."
```

> Pass the project's full UUID (`multica project list --full-id`) — a name or 8-char short ID is rejected. Every issue lives under a project.

---

## Operating the deployment

Deploy / redeploy / logs / env vars / token rotation for the Zeabur service live in
**[DEPLOY.md](./DEPLOY.md)**.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `tcmcp-remote` 401 on every call | Bearer not validated against `/api/me` | Re-issue your multica token; check `/health` reports `multica_control_plane_enabled: true` |
| `feishu_ready: false` in `/health` | Service token not admin → can't read `FEISHU_APP_SECRET` | Switch `MULTICA_SERVICE_TOKEN` to an admin/owner user (update the Zeabur var, then `zeabur service restart`) |
| `multica_control_plane_enabled: false` in `/health` | `MULTICA_CONTROL_PLANE_ENABLED=false` on server, or integration not found | Enable on multica `.env` and create integration; see Pre-flight |
| `config_source: "EnvConfigSource"` in `/health` | Control plane pull failed → fell back to env-only | Check deployment logs (`zeabur deployment log`) for the throw from `MulticaConfigSource.start()`; fix and redeploy |
| `deployment` block missing in `/health` | Integration not resolved → `DeploymentTracker` not wired | Same as above; resolve control plane connectivity first |
| `multica_reachable: false` | Network / DNS / auth | Confirm `MULTICA_URL` points at `http://multica-backend.zeabur.internal:8080` and the service token is valid |
| `beats_failed` keeps growing | Heartbeat POSTs failing (auth or network) | Check deployment logs for `heartbeat failed: ...` lines |
| No `tcmcp-remote` tools in client | Remote unreachable or bearer rejected | Confirm the URL + `Authorization` header in your client config; hit `/health` to confirm the server is up |
| Rotation not picked up | WS disconnected — check logs for `MulticaConfigSource` backoff | Auto-recovers via exponential backoff (5s → 60s cap); if stuck > 1 min, `zeabur service restart` |
