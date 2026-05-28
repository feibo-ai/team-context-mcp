// @tcmcp/remote — server entrypoint (Plan 5 M-2)
//
// Transport switch: HTTP/SSE (via @modelcontextprotocol/sdk's
// StreamableHTTPServerTransport mounted on express) or stdio. Tools are
// injected via `opts.tools`; registration of real tools happens in M-19.
//
// TODO(M-3): replace local ConfigSource placeholder with
// `import type { ConfigSource } from '@tcmcp/config'` once M-3 lands.

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Forward-looking placeholder — M-3 will export this from `@tcmcp/config`.
// Kept structural so the swap is a single import-line change.
export type ConfigSource = {
  get<T = unknown>(key: string): T | undefined;
  getSecret(key: string): Promise<string | undefined>;
  version(): number;
  onChange(callback: (changedKey: string) => void): () => void;
  start?(): Promise<void>;
  stop?(): Promise<void>;
};

export interface ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  handler: (
    args: z.infer<S>,
    ctx: { config: ConfigSource },
  ) => Promise<unknown>;
}

export interface ServerOptions {
  transport: 'http' | 'stdio';
  port?: number;
  tools: ToolDef[];
  configSource: ConfigSource;   // injected
  authMiddleware?: express.RequestHandler;   // M-16 wires this in
  healthHandler?: express.RequestHandler;    // M-17 wires this in
}

export async function startServer(opts: ServerOptions) {
  const server = new Server(
    { name: 'team-context-mcp-remote', version: '0.2.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.schema) as Record<string, unknown>,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = opts.tools.find((t) => t.name === req.params.name);
    if (!tool) throw new Error(`unknown tool: ${req.params.name}`);
    const parsed = tool.schema.parse(req.params.arguments);
    const result = await tool.handler(parsed, { config: opts.configSource });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  if (opts.transport === 'http') {
    const app = express();
    app.use(express.json({ limit: '4mb' }));
    if (opts.healthHandler) app.get('/health', opts.healthHandler);
    if (opts.authMiddleware) app.use('/mcp', opts.authMiddleware);

    const transport = new StreamableHTTPServerTransport({
      // Stateless mode: one transport per process, sessionId is ignored.
      // Switch to session mode (returning unique IDs) only if you need
      // per-client session state across requests.
      sessionIdGenerator: () => randomUUID(),
    });
    await server.connect(transport);

    // MCP endpoint — express delegates body parsing + HTTP I/O.
    app.post('/mcp', async (req, res) => {
      await transport.handleRequest(req, res, req.body);
    });
    // SSE GET (some clients use long-poll fallback)
    app.get('/mcp', async (req, res) => {
      await transport.handleRequest(req, res);
    });

    const httpServer = http.createServer(app);
    httpServer.listen(opts.port ?? 8443, () => {
      console.error(`tcmcp-remote listening on :${opts.port ?? 8443}`);
    });
  } else {
    await server.connect(new StdioServerTransport());
  }

  return server;
}
