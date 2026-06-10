# Deploy · `@tcmcp/remote` on Zeabur

The remote MCP server (`@tcmcp/remote`) runs as the **`tcmcp-remote-gres`** service
on Zeabur, project **`teamctx`**. Public URL: **`https://mcp.teamctx.actionow.ai/mcp`**
(health: `https://mcp.teamctx.actionow.ai/health`).

> This repo only owns `tcmcp-remote-gres`. As of 0.3.0 there is no `@tcmcp/local` —
> the former local stdio tools moved to team-context skills + the `multica` CLI
> (see [INSTALL.md](./INSTALL.md)). multica (`multica-backend` / `multica-web` /
> `postgresql`) is deployed from a **different repo**.

## CI/CD at a glance

```
PR ──▶ GitHub Actions `build-test` (install·build·typecheck·test)
        │  required check · main is branch-protected
        ▼
   merge to main ──▶ Zeabur git-trigger ──▶ docker build (repo Dockerfile)
                                              ▼
                                       tcmcp-remote-gres redeploys
```

- **CI** ([.github/workflows/ci.yml](.github/workflows/ci.yml)) is the only pipeline.
  It runs on PRs to `main` and on pushes to `main`. `main` is branch-protected to
  require the `build-test` check, so only tested commits land — and Zeabur only ever
  deploys tested commits.
- **CD** is **Zeabur's native git-trigger** (no GitHub Actions deploy step, no image
  registry). On any push to `main`, Zeabur pulls the repo, builds the
  [Dockerfile](./Dockerfile), and redeploys `tcmcp-remote-gres`. Only this service has
  a git-trigger pointing at this repo, so a push here never touches multica.

There is intentionally **no GHCR image / release workflow** — Zeabur builds from source,
so a separately-pushed image would be dead weight. Rollback = redeploy a previous commit
(below), not pull an old tag.

## Service identifiers

| Thing | Value |
| --- | --- |
| Zeabur project | `teamctx` · `6a1800dd7ba640a55b20bf41` |
| Environment | `6a1800dd5245baf7fc3dd7cc` |
| Service | `tcmcp-remote-gres` · `6a1805b332700e299b750370` |
| Public domain | `mcp.teamctx.actionow.ai` (port name `web` → container `8080`) |
| Git trigger | repo `feibo-ai/team-context-mcp`, branch `main`, build type `docker` |

Export these once so the commands below are copy-paste:

```bash
export TCMCP_SVC=6a1805b332700e299b750370
export TCMCP_ENV=6a1800dd5245baf7fc3dd7cc
```

## Service environment variables (set in the Zeabur dashboard)

These are the bootstrap vars Zeabur injects into the container. The app reads only
non-secret config from here; **Feishu credentials are NOT here** — they live in
multica's secret store and stream in over the control-plane WebSocket.

| Var | Value | Notes |
| --- | --- | --- |
| `MCP_TRANSPORT` | `http` | HTTP/SSE transport |
| `MCP_HTTP_PORT` | `8080` | the port the app actually binds (Zeabur routes `web` → 8080) |
| `MULTICA_URL` | `http://multica-backend.zeabur.internal:8080` | private-network address of the control plane |
| `MULTICA_SERVICE_TOKEN` | *(secret)* | **admin/owner** multica token — needed to read `FEISHU_APP_SECRET` |
| `MULTICA_WORKSPACE_ID` | *(uuid)* | WS event channel is workspace-scoped |
| `INTEGRATION_NAME` | `team-context-mcp` | which multica integration to read |
| `INTEGRATION_KIND` | `mcp-server` | shrinks the integration list query |

- `version` in `/health` comes from `GIT_SHA` if explicitly set, otherwise
  `ZEABUR_GIT_COMMIT_SHA` (auto-injected by Zeabur) — so `/health` reports the live commit.
- A legacy `PORT=8443` var may still be set; the app does **not** read it (it binds
  `MCP_HTTP_PORT`). It's a no-op and can be removed to avoid confusion.

## Deploy / redeploy

Normal path — merge a PR to `main`; Zeabur builds and deploys automatically.

Force a redeploy of the current commit (e.g. after changing a service env var):

```bash
zeabur service redeploy --id "$TCMCP_SVC" --env-id "$TCMCP_ENV"
```

Restart without rebuilding (picks up env-var changes, not code):

```bash
zeabur service restart --id "$TCMCP_SVC" --env-id "$TCMCP_ENV"
```

Rollback = redeploy an older commit from the Zeabur dashboard's deployment history
for `tcmcp-remote-gres`.

## Observe

```bash
# Build/run logs of the latest deployment
zeabur deployment log --service-id "$TCMCP_SVC" --env-id "$TCMCP_ENV"

# Health (no auth required on /health)
curl -s https://mcp.teamctx.actionow.ai/health | jq .
```

A healthy response has `status: healthy`, `multica_reachable: true`,
`feishu_ready: true`, `multica_control_plane_enabled: true`, a real `version`
(commit sha), and `deployment.beats_failed: 0`. See field semantics in
[INSTALL.md](./INSTALL.md#health-field-semantics).

## Secret & token rotation

- **Feishu app secret** — rotate in multica (`multica secret set --integration
  team-context-mcp FEISHU_APP_SECRET --value-stdin`). The running container picks it
  up over the WebSocket within a heartbeat — **no redeploy**.
- **`MULTICA_SERVICE_TOKEN`** — this admin token sits in the Zeabur service env. To
  rotate: issue a new admin/owner multica token, update the Zeabur var, then
  `zeabur service restart`. Keep Zeabur project collaborators tight — this token can
  read every integration secret.

## Local debug

[docker-compose.yml](./docker-compose.yml) builds and runs the same image locally
against a multica you point `MULTICA_URL` at. It is a debug aid only — prod is the
Zeabur git-trigger above.
