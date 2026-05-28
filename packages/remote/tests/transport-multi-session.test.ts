// Bug B (Plan 5 P1 smoke): one StreamableHTTPServerTransport per process
// locked to the first client because sessionIdGenerator is set — the
// second `initialize` saw "Server already initialized" until restart. Fix
// mounts a transport per session keyed by `mcp-session-id` header. This
// test boots the http server, connects TWO SDK clients in sequence, and
// verifies both can independently complete `initialize` and `tools/list`.
import { describe, it, expect, afterEach } from 'vitest';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startServer, type ServerHandle, type ToolDef, type ToolDeps } from '../src/server.js';

// Minimal duck-typed deps · no tools actually fire in this test, just
// tools/list is exercised. We register one trivial tool so the response
// has something to assert on.
const makeDeps = (): ToolDeps =>
  ({
    config: {
      get: () => undefined,
      getSecret: async () => undefined,
      version: () => 1,
      onChange: () => () => {},
    },
    feishu: {},
    client: {},
    teamContextRepo: '/tmp',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const tools: ToolDef[] = [
  {
    name: 'echo',
    description: 'echo test',
    schema: z.object({ msg: z.string() }),
    handler: async (args) => ({ echoed: (args as { msg: string }).msg }),
  },
];

async function bootServer(): Promise<ServerHandle> {
  // Port 0 → OS-assigned free port. We read it from httpServer.address() so
  // the two clients connect to the same instance.
  return startServer({
    transport: 'http',
    port: 0,
    tools,
    deps: makeDeps(),
    // No authMiddleware → bypass /api/me lookup (test only needs transport).
  });
}

function urlFor(handle: ServerHandle): URL {
  const addr = handle.httpServer?.address();
  if (!addr || typeof addr === 'string') throw new Error('no address bound');
  return new URL(`http://127.0.0.1:${addr.port}/mcp`);
}

async function closeHandle(h: ServerHandle): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (!h.httpServer) return resolve();
    h.httpServer.close((err) => (err ? reject(err) : resolve()));
  });
}

describe('streamable http transport · multi-session (Bug B)', () => {
  let handle: ServerHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await closeHandle(handle);
      handle = undefined;
    }
  });

  it('two concurrent SDK clients both complete initialize + tools/list', async () => {
    handle = await bootServer();
    const url = urlFor(handle);

    const clientA = new Client({ name: 'test-A', version: '0.0.1' });
    const transportA = new StreamableHTTPClientTransport(url);
    await clientA.connect(transportA);

    const clientB = new Client({ name: 'test-B', version: '0.0.1' });
    const transportB = new StreamableHTTPClientTransport(url);
    await clientB.connect(transportB);

    // Both initialized — server map must have two distinct sessions.
    expect(handle.transports?.size).toBe(2);

    const listA = await clientA.listTools();
    const listB = await clientB.listTools();

    expect(listA.tools).toHaveLength(1);
    expect(listA.tools[0]?.name).toBe('echo');
    expect(listB.tools).toHaveLength(1);
    expect(listB.tools[0]?.name).toBe('echo');

    // tools/list response inputSchema must have type:'object' at root —
    // also covers Bug A on the real wire format.
    expect(listA.tools[0]?.inputSchema?.type).toBe('object');

    await clientA.close();
    await clientB.close();
  }, 15000);

  it('request with unknown session-id returns 400 (no fallthrough to a fresh session)', async () => {
    handle = await bootServer();
    const url = urlFor(handle);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-session-id': 'not-a-real-session',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: 1,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code: number } };
    expect(body.error?.code).toBe(-32600);
  });

  it('non-initialize POST without session-id returns 400', async () => {
    handle = await bootServer();
    const url = urlFor(handle);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: 1,
      }),
    });
    expect(res.status).toBe(400);
  });
});
