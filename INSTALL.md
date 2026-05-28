# Install · v0.2 (hybrid · remote + local)

Two install paths. Most people do the **light** path; one DRI does the **full** path.

---

## Team members (most people · light path)

You only need the local stdio server. The DRI runs the remote server on their mac and gives you the URL + your bearer token.

The DRI will share two values with you:
- **Remote MCP URL** — e.g. `https://tcmcp.aimiq.local:8443/mcp` (or `http://<dri-hostname>:8443/mcp` on the LAN)
- **Your personal multica bearer token** — same JWT you use for the multica CLI; copy from `~/.multica/token` or run `multica auth token`

### 1. Clone + build the local server

```bash
git clone git@github.com:feibo-ai/team-context-mcp.git ~/team-context-mcp
cd ~/team-context-mcp
pnpm install
pnpm --filter '@tcmcp/local' build
```

### 2. Wire both servers into Claude Code

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on Windows/Linux:

```json
{
  "mcpServers": {
    "tcmcp-remote": {
      "url": "https://tcmcp.aimiq.local:8443/mcp",
      "headers": { "Authorization": "Bearer <your-multica-token>" }
    },
    "tcmcp-local": {
      "command": "node",
      "args": ["/Users/<you>/team-context-mcp/packages/local/dist/server.js"]
    }
  }
}
```

Replace `<your-multica-token>` and `<you>` with your values. The remote URL and the local path are independent — failing to reach the remote server only disables the 10 Feishu/SOP-broadcast tools; the 12 local tools still work.

### 3. Wire into Codex CLI (optional)

```bash
codex mcp add tcmcp-local -- node /Users/<you>/team-context-mcp/packages/local/dist/server.js
codex mcp add-http tcmcp-remote https://tcmcp.aimiq.local:8443/mcp \
  --header "Authorization: Bearer <your-multica-token>"
```

### 4. Verify

Restart Claude Code / Codex. Ask "What tools do you have from tcmcp-remote and tcmcp-local?"

Expected: **22 tools** total — 10 from `tcmcp-remote`, 12 from `tcmcp-local`. See [README.md](./README.md) for the breakdown.

---

## DRI (sets up the remote server on their mac · per Decision D-H)

The DRI is whoever the team picked to host the always-on remote process — typically the team's tech lead. One mac runs it, everyone else connects.

### Pre-flight · multica side

Plan-5 boot will **fail or silently degrade** unless these three preconditions hold:

1. **Control plane enabled.** multica server `.env` must include `MULTICA_CONTROL_PLANE_ENABLED=true`.
   Otherwise `/api/integrations/*` routes return 404 and `MulticaConfigSource.start()` throws a
   `control plane disabled` error on boot — this is intentional (see `packages/config/src/multica.ts`
   `start()`). The remote server falls back to env-only mode and `/health` reports `controlPlaneOk=false`.
2. **Secret master key set.** multica server `.env` must include a base64-encoded 32-byte
   `MULTICA_SECRET_MASTER_KEY`. Without it `multica secret set` errors out at the CLI before
   anything reaches the wire.
3. **Integration + secrets pushed.** This is the manual step in [Setup](#setup) below (steps 2–3).

### Pre-flight · service token capability

The token passed via `MULTICA_SERVICE_TOKEN` must belong to a user with **workspace admin or
owner role** — otherwise secret reads return 403 and `FeishuClient.ensureSdk()` fails on every
remote tool call:

| Endpoint                                   | Member role                       | Admin / Owner |
| ------------------------------------------ | --------------------------------- | ------------- |
| `GET /api/integrations/{id}`               | 200 (non-secret config readable)  | 200           |
| `GET /api/integrations/{id}/secrets/{key}` | **403**                           | 200           |
| → FeishuClient `ensureSdk()` rebuild       | **fails (no APP_SECRET)**         | works         |

Verify before running `docker compose up`:

```bash
INT_ID=$(multica integration list --kind mcp-server --output json \
         | jq -r '.[] | select(.name=="team-context-mcp") | .id')

curl -H "Authorization: Bearer $MULTICA_SERVICE_TOKEN" \
     -H "X-Workspace-Id: $MULTICA_WORKSPACE_ID" \
     "$MULTICA_URL/api/integrations/$INT_ID/secrets/FEISHU_APP_ID"
# Expect: 200 with JSON · NOT 403
```

If you see 403, switch the service token to an admin/owner user before continuing.

### Setup

#### 1. Set bootstrap env in `~/.tcmcp.env`

```bash
MULTICA_URL=http://localhost:8083                # macOS host (Docker rewrites to host.docker.internal)
MULTICA_SERVICE_TOKEN=<workspace-admin-token>    # NOT a member token (see Pre-flight capability table)
MULTICA_WORKSPACE_ID=<your-workspace-uuid>       # required — WS event channel is workspace-scoped
INTEGRATION_NAME=team-context-mcp
INTEGRATION_KIND=mcp-server                      # shrinks /api/integrations list query
GIT_SHA=$(git rev-parse --short HEAD)            # surfaced via DeploymentTracker (M-18)
```

`docker compose` reads this file via its `${VAR}` substitution (export them in your shell, or
`set -a && source ~/.tcmcp.env && set +a` before `compose up`).

#### 2. Create the multica integration (one time)

```bash
multica integration create \
  --kind mcp-server \
  --name team-context-mcp \
  --config '{"feishu_team_chat_id":"oc_xxx","feishu_wiki_space_id":"wikcn..."}'
```

`feishu_team_chat_id` is where `notify_team` posts. `feishu_wiki_space_id` is the parent space
for `archive_to_wiki`. Both are non-secret config (readable by every workspace member).

#### 3. Set secrets (token must be admin — see Pre-flight above)

```bash
echo -n "$FEISHU_APP_ID"     | multica secret set --integration team-context-mcp FEISHU_APP_ID     --value-stdin
echo -n "$FEISHU_APP_SECRET" | multica secret set --integration team-context-mcp FEISHU_APP_SECRET --value-stdin
```

Rotation is reactive — push a new secret and the running container picks it up via WS within
a heartbeat. No `docker restart`.

#### 4. Start the container

```bash
cd ~/team-context-mcp
docker compose up -d
curl http://localhost:8443/health
```

Expected `/health` JSON:

```json
{
  "ok": true,
  "controlPlaneOk": true,
  "configVersion": 1,
  "multica": "ok",
  "feishu": "ok",
  "gitSha": "abc1234"
}
```

If `controlPlaneOk` is `false`: revisit the Pre-flight section. If `feishu` is `"error"`:
your service token can't read the secret — see the capability table.

### 5. Share with the team

Once `/health` is green, broadcast the URL + token-creation instructions:

```bash
multica issue create \
  --project team-context-mcp \
  --title "tcmcp-remote is live · v0.2" \
  --body "URL: http://$(hostname).local:8443/mcp · Each member runs \`multica auth token\` for their bearer · See INSTALL.md team-member path."
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `tcmcp-remote` 401 on every call | Bearer not validated against `/api/me` | Re-issue your multica token; check `/health` reports `controlPlaneOk=true` |
| `feishu: error` in `/health` | Service token not admin → can't read `FEISHU_APP_SECRET` | Switch `MULTICA_SERVICE_TOKEN` to an admin/owner user |
| `controlPlaneOk=false` in `/health` | `MULTICA_CONTROL_PLANE_ENABLED=false` on server, or integration not found | Enable on multica `.env` and create integration; see Pre-flight |
| Local tools missing in client | Wrong path to `packages/local/dist/server.js` | Run `pnpm --filter '@tcmcp/local' build` then check the absolute path |
| Rotation not picked up | WS disconnected — check container logs for `MulticaConfigSource` backoff | Auto-recovers via exponential backoff; if stuck > 1 min, `docker compose restart tcmcp-remote` |
