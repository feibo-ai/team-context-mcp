# Install

## Prerequisites
- Node 20+
- multica CLI authenticated (`multica auth status` ok)

## Build

```bash
git clone <repo-url> ~/team-context-mcp
cd ~/team-context-mcp
pnpm install
pnpm build
```

## Wire into Claude Code

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "team-context-mcp": {
      "command": "node",
      "args": ["/Users/<you>/team-context-mcp/dist/server.js"]
    }
  }
}
```

Restart Claude Code.

## Wire into Codex CLI

```bash
codex mcp add team-context-mcp -- node /Users/<you>/team-context-mcp/dist/server.js
```

## Verify

In a fresh Claude/Codex session: ask "What tools do you have?"
Expected: 8 tools listed.
