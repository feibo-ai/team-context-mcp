// @tcmcp/remote — server entrypoint (Plan 5 M-2, M-19 full registration)
//
// Transport switch: HTTP/SSE (via @modelcontextprotocol/sdk's
// StreamableHTTPServerTransport mounted on express) or stdio. M-19 wires
// the full set of 10 remote-capable tools and the platform services they
// need (MulticaClient, FeishuClient, ConfigSource).
//
// Bootstrap flow (`main()` below):
//   1. Read bootstrap env (MULTICA_URL/MULTICA_SERVICE_TOKEN/MULTICA_WORKSPACE_ID
//      /INTEGRATION_NAME/INTEGRATION_KIND).
//   2. Construct MulticaConfigSource; call start(). On 404 (multica's control
//      plane disabled), fall back to env-only via LayeredConfigSource and set
//      `controlPlaneOk=false` so /health reports degraded mode honestly.
//   3. Construct FeishuClient + MulticaClient + MulticaControlPlaneClient.
//   4. Wire auth middleware (M-16), /health (M-17), DeploymentTracker (M-18).
//   5. startServer({transport, tools, deps, ...}).

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import type { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  EnvConfigSource,
  LayeredConfigSource,
  MulticaConfigSource,
  MulticaControlPlaneClient,
  type ConfigSource,
} from '@tcmcp/config';
import { FeishuClient } from '@tcmcp/feishu';
import { MulticaClient } from '@tcmcp/shared';

import { createAuthMiddleware } from './auth.js';
import { healthHandler } from './health.js';
import { DeploymentTracker } from './deployment.js';

// Tools (5 moved in M-19 + 5 new from M-9..M-13)
import { planRequestReview, planRequestReviewInput } from './tools/plan_request_review.js';
import { bettingTableCapture, bettingTableCaptureInput } from './tools/betting_table_capture.js';
import { burnoutCheckDistribute, burnoutCheckDistributeInput } from './tools/burnout_check_distribute.js';
import { shouldIUseAi, shouldIUseAiInput } from './tools/should_i_use_ai.js';
import { codeReviewRequest, codeReviewRequestInput } from './tools/code_review_request.js';
import { notifyTeam, notifyTeamInput } from './tools/notify_team.js';
import { dmMember, dmMemberInput } from './tools/dm_member.js';
import { archiveToWiki, archiveToWikiInput } from './tools/archive_to_wiki.js';
import { searchChat, searchChatInput } from './tools/search_chat.js';
import { readMemberDm, readMemberDmInput } from './tools/read_member_dm.js';

// Re-export so tests can import the symbol without reaching into source.
export type { ConfigSource };

/**
 * Aggregated deps passed to every tool handler. Each handler picks what it
 * needs (most tools use a 1- or 2-key subset). This keeps registration one
 * uniform shape while preserving each tool's narrower `deps` signature.
 */
export interface ToolDeps {
  config: ConfigSource;
  feishu: FeishuClient;
  client: MulticaClient;
  teamContextRepo: string;
}

export interface ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  handler: (args: z.infer<S>, deps: ToolDeps) => Promise<unknown>;
}

export interface ServerOptions {
  transport: 'http' | 'stdio';
  port?: number;
  tools: ToolDef[];
  deps: ToolDeps;
  authMiddleware?: express.RequestHandler;
  healthHandler?: express.RequestHandler;
}

/**
 * Result of `startServer`. `server` is always present (the stdio Server, or a
 * representative Server for the http path — kept for backward-compat with the
 * old single-instance shape). `httpServer` is set in http mode so callers can
 * close it (tests use this for teardown). `transports` is the live per-session
 * map in http mode · exposed for test inspection.
 */
export interface ServerHandle {
  server: Server;
  httpServer?: http.Server;
  transports?: Map<string, StreamableHTTPServerTransport>;
}

/**
 * Register tools/list + tools/call handlers on a Server instance. Hoisted out
 * of the inline so each per-session http Server gets the same handlers as the
 * stdio Server. Closes over `opts` (tools + deps).
 */
function registerHandlers(server: Server, opts: ServerOptions): void {
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
    const result = await tool.handler(parsed, opts.deps);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  });
}

export async function startServer(opts: ServerOptions): Promise<ServerHandle> {
  // Top-level Server · used directly by stdio mode, and returned for backward
  // compat with the old `Promise<Server>` shape via `handle.server`. In http
  // mode each session gets its own Server (see below).
  const server = new Server(
    { name: 'team-context-mcp-remote', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );
  registerHandlers(server, opts);

  if (opts.transport === 'http') {
    const app = express();
    app.use(express.json({ limit: '4mb' }));
    if (opts.healthHandler) app.get('/health', opts.healthHandler);
    if (opts.authMiddleware) app.use('/mcp', opts.authMiddleware);

    // Per-session transport mounting (P1 Bug B fix). The first `initialize`
    // without a session-id header creates a new {Server, transport} pair;
    // subsequent requests route by `mcp-session-id` header. The single-
    // transport-per-process pattern (which we had) locks to the first
    // client because sessionIdGenerator is set — second initialize sees
    // "already initialized" until server restart, blocking concurrent MCP
    // clients (multiple team-member laptops on the same tcmcp-remote).
    const transports = new Map<string, StreamableHTTPServerTransport>();

    const handleMcp = async (
      req: express.Request,
      res: express.Response,
    ): Promise<void> => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId);
      } else if (
        !sessionId &&
        req.method === 'POST' &&
        (req.body as { method?: string } | undefined)?.method === 'initialize'
      ) {
        // New session: spin up a fresh Server (so each session has its own
        // request handlers; cheap because they're closures over `opts`).
        const sessionServer = new Server(
          { name: 'team-context-mcp-remote', version: '0.2.0' },
          { capabilities: { tools: {} } },
        );
        registerHandlers(sessionServer, opts);

        const sessionTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            transports.set(sid, sessionTransport);
          },
        });
        sessionTransport.onclose = (): void => {
          if (sessionTransport.sessionId)
            transports.delete(sessionTransport.sessionId);
        };
        await sessionServer.connect(sessionTransport);
        transport = sessionTransport;
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message:
              'Invalid: missing or unknown session-id (send `initialize` without a session-id header to create one)',
          },
          id: null,
        });
        return;
      }

      if (!transport) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'no transport' },
          id: null,
        });
        return;
      }

      await transport.handleRequest(
        req,
        res,
        req.method === 'POST' ? req.body : undefined,
      );
    };

    app.post('/mcp', handleMcp);
    app.get('/mcp', handleMcp);
    app.delete('/mcp', handleMcp); // SDK uses DELETE for session cleanup

    const httpServer = http.createServer(app);
    await new Promise<void>((resolve) => {
      httpServer.listen(opts.port ?? 8443, () => {
        process.stderr.write(
          `tcmcp-remote listening on :${opts.port ?? 8443}\n`,
        );
        resolve();
      });
    });
    return { server, httpServer, transports };
  }

  await server.connect(new StdioServerTransport());
  return { server };
}

/**
 * The 10 remote-capable tools registered by this server.
 *   - 5 from old root src/server.ts (M-19 moved them): plan_request_review,
 *     betting_table_capture, burnout_check_distribute, should_i_use_ai,
 *     code_review_request
 *   - 5 new in Plan-5 M-9..M-13: notify_team, dm_member, archive_to_wiki,
 *     search_chat, read_member_dm
 */
export function buildToolDefs(): ToolDef[] {
  return [
    {
      name: 'plan_request_review',
      description: 'Label plan under-review + post reviewer prompt.',
      schema: planRequestReviewInput,
      handler: (i, d) =>
        planRequestReview(i as z.infer<typeof planRequestReviewInput>, {
          client: d.client,
        }),
    },
    {
      name: 'betting_table_capture',
      description: 'Friday 投注表 issue (open / close / tally).',
      schema: bettingTableCaptureInput,
      handler: (i, d) =>
        bettingTableCapture(
          i as z.infer<typeof bettingTableCaptureInput>,
          { client: d.client },
        ),
    },
    {
      name: 'burnout_check_distribute',
      description:
        'Monthly anonymized burnout check (distribute / collect).',
      schema: burnoutCheckDistributeInput,
      handler: (i, d) =>
        burnoutCheckDistribute(
          i as z.infer<typeof burnoutCheckDistributeInput>,
          { client: d.client, feishu: d.feishu },
        ),
    },
    {
      name: 'should_i_use_ai',
      description:
        'METR-aligned decision aid: use-ai / write-directly / borderline.',
      schema: shouldIUseAiInput,
      handler: (i) =>
        shouldIUseAi(i as z.infer<typeof shouldIUseAiInput>, undefined),
    },
    {
      name: 'code_review_request',
      description:
        'Block self-review (❌1). Assign a reviewer + 代码评审 label.',
      schema: codeReviewRequestInput,
      handler: (i, d) =>
        codeReviewRequest(
          i as z.infer<typeof codeReviewRequestInput>,
          { client: d.client },
        ),
    },
    {
      name: 'notify_team',
      description:
        'Send text or interactive card to the team Feishu chat (config: feishu_team_chat_id).',
      schema: notifyTeamInput,
      handler: (i, d) =>
        notifyTeam(i as z.infer<typeof notifyTeamInput>, {
          config: d.config,
          feishu: d.feishu,
        }),
    },
    {
      name: 'dm_member',
      description: 'Send a P2P direct message to a member by email.',
      schema: dmMemberInput,
      handler: (i, d) => dmMember(i, { feishu: d.feishu }),
    },
    {
      name: 'archive_to_wiki',
      description:
        'Import a local markdown file as a Feishu docx, then link it under a wiki node.',
      schema: archiveToWikiInput,
      handler: (i, d) =>
        archiveToWiki(i as z.infer<typeof archiveToWikiInput>, {
          config: d.config,
          feishu: d.feishu,
        }),
    },
    {
      name: 'search_chat',
      description:
        'Search Feishu workspace chats by query string (maintenance helper).',
      schema: searchChatInput,
      handler: (i, d) =>
        searchChat(i as z.infer<typeof searchChatInput>, { feishu: d.feishu }),
    },
    {
      name: 'read_member_dm',
      description:
        'Read recent P2P chat history for one team member (used by burnout_check_distribute collect).',
      schema: readMemberDmInput,
      handler: (i, d) =>
        readMemberDm(i as z.infer<typeof readMemberDmInput>, {
          feishu: d.feishu,
        }),
    },
  ];
}

/**
 * Same zod → JSON Schema strategy as the old root src/server.ts. The shared
 * `zod-to-json-schema` package would also work, but a hand-rolled walker
 * keeps the output stable and avoids drift in MCP client tooling. Exported
 * so tests can verify Bug A (type:'object' enforced at root) without
 * spinning up an HTTP server.
 */
export function zodToJsonSchema(s: z.ZodTypeAny): unknown {
  const out = walk(s) as Record<string, unknown>;
  // MCP spec requires inputSchema.type === 'object' at the root. Tools that
  // use z.union / z.discriminatedUnion / .refine() at the top level produce
  // { oneOf: [...] } / { anyOf: [...] } via `walk` without a top-level type,
  // which strict MCP SDK clients reject (Codex was lenient · Plan 5 P1
  // Bug A). The oneOf/anyOf branches themselves are object schemas so
  // forcing type:'object' here is JSON-Schema-valid.
  if (!out.type) out.type = 'object';
  return out;
}

function walk(s: z.ZodTypeAny): unknown {
  // Avoid importing zod runtime at the top of this file by deferring to the
  // tools' own zod types. We use a tagged-name dispatch instead of instanceof
  // so we don't take on a hard dep on a specific zod runtime version here.
  const tag = (s as { _def?: { typeName?: string } })._def?.typeName;
  switch (tag) {
    case 'ZodObject': {
      const shape = (s as unknown as { shape: Record<string, z.ZodTypeAny> })
        .shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = walk(v);
        if (!(v as { isOptional: () => boolean }).isOptional()) required.push(k);
      }
      return { type: 'object', properties, required };
    }
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodArray':
      return {
        type: 'array',
        items: walk((s as unknown as { _def: { type: z.ZodTypeAny } })._def.type),
      };
    case 'ZodEnum':
      return {
        type: 'string',
        enum: (s as unknown as { _def: { values: string[] } })._def.values,
      };
    case 'ZodLiteral':
      return { const: (s as unknown as { _def: { value: unknown } })._def.value };
    case 'ZodDiscriminatedUnion': {
      const opts = (s as unknown as { options: Map<unknown, z.ZodTypeAny> | z.ZodTypeAny[] })
        .options;
      const arr: z.ZodTypeAny[] = opts instanceof Map ? Array.from(opts.values()) : opts;
      return { oneOf: arr.map((o) => walk(o)) };
    }
    case 'ZodUnion': {
      const opts = (s as unknown as { _def: { options: z.ZodTypeAny[] } })._def
        .options;
      return { oneOf: opts.map((o) => walk(o)) };
    }
    case 'ZodRecord':
      return {
        type: 'object',
        additionalProperties: walk(
          (s as unknown as { _def: { valueType: z.ZodTypeAny } })._def.valueType,
        ),
      };
    case 'ZodEffects':
      return walk((s as unknown as { _def: { schema: z.ZodTypeAny } })._def.schema);
    case 'ZodDefault':
      return walk(
        (s as unknown as { _def: { innerType: z.ZodTypeAny } })._def.innerType,
      );
    case 'ZodOptional':
      return walk(
        (s as unknown as { _def: { innerType: z.ZodTypeAny } })._def.innerType,
      );
    default:
      return {};
  }
}

/**
 * Entrypoint when run as a bin (`node packages/remote/dist/server.js`).
 *   - Reads bootstrap env, wires the platform.
 *   - Falls back to env-only ConfigSource on multica-control-plane 404.
 *   - Spawns DeploymentTracker if MulticaConfigSource resolved an integration_id.
 */
async function main(): Promise<void> {
  const transport = (process.env.MCP_TRANSPORT as 'http' | 'stdio') ?? 'http';
  const port = process.env.MCP_HTTP_PORT ? Number(process.env.MCP_HTTP_PORT) : 8443;

  const multicaUrl =
    process.env.MULTICA_URL ?? process.env.MULTICA_SERVER_URL ?? '';
  const serviceToken = process.env.MULTICA_SERVICE_TOKEN ?? '';
  const workspaceId = process.env.MULTICA_WORKSPACE_ID ?? '';
  const integrationName =
    process.env.INTEGRATION_NAME ?? 'team-context-mcp';
  const integrationKind = process.env.INTEGRATION_KIND ?? 'mcp-server';
  const teamContextRepo = process.env.TEAM_CONTEXT_REPO ?? process.cwd();

  if (!multicaUrl || !serviceToken || !workspaceId) {
    throw new Error(
      'MULTICA_URL + MULTICA_SERVICE_TOKEN + MULTICA_WORKSPACE_ID are required',
    );
  }

  // Build config source. Primary = multica integration config (live). Fallback
  // = env (for `controlPlaneOk=false` mode when multica is misconfigured).
  const multicaSource = new MulticaConfigSource({
    serverUrl: multicaUrl,
    serviceToken,
    workspaceId,
    integrationName,
    kind: integrationKind,
  });
  let controlPlaneOk = false;
  try {
    await multicaSource.start();
    controlPlaneOk = true;
  } catch (e) {
    process.stderr.write(
      `MulticaConfigSource.start() failed: ${e}\nFalling back to env-only config.\n`,
    );
  }
  const configSource: ConfigSource = controlPlaneOk
    ? new LayeredConfigSource([multicaSource, new EnvConfigSource()])
    : new LayeredConfigSource([new EnvConfigSource()]);

  // Platform clients
  const feishu = new FeishuClient(configSource);
  const multicaCp = new MulticaControlPlaneClient({
    serverUrl: multicaUrl,
    serviceToken,
    workspaceId,
  });
  const client = new MulticaClient({
    serverUrl: multicaUrl,
    token: serviceToken,
    workspaceId,
  });

  // Deployment tracker (best-effort; never crashes the server). Hoisted out
  // of the `if` block so /health can surface its stats (P3 follow-up · was
  // TODO(M-17) in deployment.ts).
  const integrationId = (multicaSource as unknown as { integrationId?: string })
    .integrationId;
  let tracker: DeploymentTracker | undefined;
  if (controlPlaneOk && integrationId) {
    tracker = new DeploymentTracker({
      client: multicaCp,
      integrationId,
      imageOrCommit:
        process.env.GIT_SHA ?? process.env.ZEABUR_GIT_COMMIT_SHA ?? 'dev',
      hostUrl: process.env.HOST_URL,
      getConfigVersion: () => configSource.version(),
    });
    void tracker.start();
  }

  // Auth + health
  const authMw = createAuthMiddleware(multicaUrl);
  const health = healthHandler({
    configSource,
    feishu: feishu as unknown as { ping?: () => Promise<unknown> },
    multica: {
      ping: () => multicaCp.ping(),
      controlPlaneOk,
    },
    deployment: tracker,
  });

  await startServer({
    transport,
    port,
    tools: buildToolDefs(),
    deps: { config: configSource, feishu, client, teamContextRepo },
    authMiddleware: transport === 'http' ? authMw : undefined,
    healthHandler: transport === 'http' ? health : undefined,
  });
}

// Only run main() when executed directly (not when imported as a module by
// tests). Detect via `import.meta.url` matching argv[1].
if (
  import.meta.url ===
  `file://${process.argv[1] ?? ''}`.replace(/\\/g, '/')
) {
  main().catch((err) => {
    process.stderr.write(`${err}\n`);
    process.exit(1);
  });
}
