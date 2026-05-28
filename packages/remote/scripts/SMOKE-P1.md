# P1 Smoke · 10 remote tools end-to-end

One-shot ops smoke script. Hits every remote MCP tool with a synthetic
input through the actual HTTP/SSE transport, proving:

- transport accepts the initialize handshake
- bearer auth (M-16) approves the token
- all 10 tools are registered + listed
- each tool's input schema validates the synthetic body
- each tool's handler dispatches (success OR a downstream-dep error like
  feishu 400 / missing multica label — both count as "path-ok" because the
  Plan 5 code path executed before the external dep failed)

## Run

```bash
# Boot the server in one terminal:
MULTICA_URL=http://localhost:8080 \
MULTICA_SERVICE_TOKEN=mul_xxx \
MULTICA_WORKSPACE_ID=<uuid> \
INTEGRATION_NAME=team-context-mcp \
INTEGRATION_KIND=mcp-server \
MCP_TRANSPORT=http MCP_HTTP_PORT=8443 \
node dist/server.js

# In another terminal, point at it and run:
TCMCP_TOKEN=<bearer> node scripts/smoke-p1.mjs
```

## Expected output

```
✓ initialized · sid=<uuid>

=== Smoke Results · 10 remote tools ===
[OK          ] should_i_use_ai              {...recommendation...}
[OK          ] search_chat                  {...chats...}
[OK          ] notify_team                  {...messageId...}        ← real feishu push
[JSONRPC-ERR ] dm_member                    feishu 400 — autopilot-bot@aimiq.test not in feishu org
[JSONRPC-ERR ] read_member_dm               feishu 400 — same reason
[JSONRPC-ERR ] archive_to_wiki              feishu 400 — dummy wikiSpaceId rejected (path executed)
[OK          ] burnout_check_distribute     {sentCount:0, failedEmails:[...]}
[JSONRPC-ERR ] code_review_request          multica label "code-review" not created
[JSONRPC-ERR ] plan_request_review          multica label "plan-under-review" not created
[JSONRPC-ERR ] betting_table_capture        multica label "betting-table" not created
```

4/10 fully clean; 6/10 show downstream-dep errors that prove the code path
ran. To get more OK rows, set up the missing multica labels and use real
feishu emails — those are operational config, not Plan 5 bugs.

## P1-surfaced bugs (separate follow-ups, not Plan 5 code regressions)

These were found while running this smoke, *not* by the smoke itself. They
were always there — the smoke just made them visible.

### Bug A · `inputSchema.type` missing for union tools

Tools that use `z.union(...)` / `z.discriminatedUnion(...)` for their input
schema produce JSON Schema of the form `{ anyOf: [...] }` *without* the
top-level `type: "object"` that the MCP spec requires.

Effect: strict MCP SDK clients (anything that schema-validates the
`tools/list` response with the SDK's bundled validator) refuse the
response with a zod error citing `tools[N].inputSchema.type`. The Codex
CLI happens to be lenient and doesn't trip on this, which is why the
Plan 6 autopilot smoke succeeded — but a stricter client would not work.

Affected tools (current count: 4):
- `notify_team` — `z.union([{text}, {card}])`
- `dm_member` — base object + `.refine()` that drops `type` at the JSON-Schema layer
- `burnout_check_distribute` — `z.discriminatedUnion('action', [...])`
- `betting_table_capture` — `z.discriminatedUnion('action', [...])`

Fix sketch: post-process the generated JSON Schema in `buildToolDefs()` /
zod-to-json-schema usage to ensure `inputSchema = { type: 'object', ...rest }`
at the top level. Or wrap union members in an enclosing object schema.

### Bug B · single-session transport mounting

`packages/remote/src/server.ts:116` constructs **one** `StreamableHTTPServerTransport`
per process and calls `server.connect(transport)` once. With a non-null
`sessionIdGenerator`, the SDK treats this transport as session-scoped —
the FIRST `initialize` call binds the transport to that session, and any
later `initialize` (e.g. a fresh client / a smoke script restart with the
server still up) gets `"Invalid Request: Server already initialized"`.

Effect: only one MCP client can use the server at a time. Multiple Claude
Code / Codex instances on different team members' laptops cannot share
one tcmcp-remote — they'd each need a separate process. The Plan 6 single
autopilot demo passes because there's exactly one consumer at a time.

Fix sketch: per the MCP SDK multi-session example, mount a transport
**per request** keyed off the `mcp-session-id` header — create a new
`{ Server, transport }` pair on the first request without a session id,
then route subsequent requests by id. Roughly 20-30 lines of refactor in
`server.ts`.

Both bugs are non-blocking for the current single-DRI, single-autopilot
deployment but should land before the team adds a second concurrent client.
