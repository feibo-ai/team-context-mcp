// packages/config/tests/multica.test.ts
//
// Covers M-5 happy path: start → pull → cache → get/getSecret/version/onChange.
// Uses undici MockAgent to intercept HTTP. WebSocket is stubbed so we can call
// pull() through `start()` without a live socket.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
import { MulticaConfigSource } from '../src/multica.js';

const BASE = 'http://multica.test';
const WS_ID = 'ws-1';
const TOKEN = 'tok';
const INT_NAME = 'feishu-prod';
const INT_ID = 'int-uuid-1';

let savedDispatcher: Dispatcher;
let mockAgent: MockAgent;

// Suppress the real WebSocket — every test in this file uses pull-only paths.
// connectWebSocket creates a `new WebSocket(...)` whose constructor would try
// to dial the (non-existent) ws://multica.test endpoint and emit `error`/
// `close` events into the unhandled-rejection sink. Returning a dummy stops
// that. We stub via a module mock so the import inside multica.ts is replaced.
vi.mock('ws', () => {
  class FakeWS {
    on() { return this; }
    close() {}
    removeAllListeners() {}
  }
  return { default: FakeWS };
});

function intResponse(version: number, config: Record<string, unknown>) {
  return [
    {
      id: INT_ID,
      kind: 'mcp-server',
      name: INT_NAME,
      config,
      version,
      status: 'active',
    },
  ];
}

function newSource(secretCacheTtlMs?: number) {
  return new MulticaConfigSource({
    serverUrl: BASE,
    serviceToken: TOKEN,
    workspaceId: WS_ID,
    integrationName: INT_NAME,
    kind: 'mcp-server',
    secretCacheTtlMs,
    pollIntervalMs: 60_000_000, // effectively disable poll loop in tests
  });
}

describe('MulticaConfigSource', () => {
  beforeEach(() => {
    savedDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  afterEach(async () => {
    await mockAgent.close();
    setGlobalDispatcher(savedDispatcher);
  });

  it('start() pulls config from MockAgent and populates cache', async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: '/api/integrations?kind=mcp-server', method: 'GET' })
      .reply(200, intResponse(7, { FEISHU_TEAM_CHAT_ID: 'oc_xxx' }));

    const s = newSource();
    await s.start();
    expect(s.get('FEISHU_TEAM_CHAT_ID')).toBe('oc_xxx');
    expect(s.version()).toBe(7);
    await s.stop();
  });

  it('get(key) returns the value, undefined for missing keys', async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: '/api/integrations?kind=mcp-server', method: 'GET' })
      .reply(200, intResponse(1, { A: '1', B: 2 }));

    const s = newSource();
    await s.start();
    expect(s.get<string>('A')).toBe('1');
    expect(s.get<number>('B')).toBe(2);
    expect(s.get('MISSING')).toBeUndefined();
    await s.stop();
  });

  it('getSecret(): first call hits server, second within TTL is cached', async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: '/api/integrations?kind=mcp-server', method: 'GET' })
      .reply(200, intResponse(1, {}));
    // Only ONE secret-fetch interceptor; if cache misses we'd get
    // MockNotMatchedError on the 2nd request.
    pool
      .intercept({
        path: `/api/integrations/${INT_ID}/secrets/FEISHU_APP_SECRET`,
        method: 'GET',
      })
      .reply(200, { value: 'shh', version: 1 });

    const s = newSource(); // default 5-min TTL
    await s.start();
    expect(await s.getSecret('FEISHU_APP_SECRET')).toBe('shh');
    expect(await s.getSecret('FEISHU_APP_SECRET')).toBe('shh'); // cache hit
    await s.stop();
  });

  it('version() reflects integration.version after pull', async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: '/api/integrations?kind=mcp-server', method: 'GET' })
      .reply(200, intResponse(42, {}));

    const s = newSource();
    await s.start();
    expect(s.version()).toBe(42);
    await s.stop();
  });

  it('onChange fires when version bumps on subsequent pull', async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: '/api/integrations?kind=mcp-server', method: 'GET' })
      .reply(200, intResponse(1, { K: 'v1' }));
    pool
      .intercept({ path: '/api/integrations?kind=mcp-server', method: 'GET' })
      .reply(200, intResponse(2, { K: 'v2' }));

    const s = newSource();
    const cb = vi.fn();
    await s.start();
    s.onChange(cb);
    // Drive a second pull manually (bypassing the long poll interval).
    await (s as unknown as { pull: () => Promise<void> }).pull();
    expect(cb).toHaveBeenCalledWith('*');
    expect(s.get('K')).toBe('v2');
    expect(s.version()).toBe(2);
    await s.stop();
  });

  it('start() throws clear "control plane disabled" error on 404', async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: '/api/integrations?kind=mcp-server', method: 'GET' })
      .reply(404, 'not found');

    const s = newSource();
    await expect(s.start()).rejects.toThrow(/control plane disabled/);
    await s.stop();
  });
});
