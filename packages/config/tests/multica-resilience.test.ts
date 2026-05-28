// packages/config/tests/multica-resilience.test.ts
//
// M-6: WS reconnect + circuit breaker.
// - Test 1: WS server drops connection → client reconnects within 6 s
//   (real ws.Server on a random port; first ~5 s reconnect timer triggers).
// - Test 2: 5 consecutive WS failures → reconnect timer scheduled at the
//   60 s cap (drives the impl's close-handler directly via a stubbed ws
//   module and inspects setTimeout calls).
// - Test 3: Poll endpoint returns 500 → process doesn't crash, last-known
//   config still served via get().
//
// Test 1 uses the real `ws` module against a localhost WebSocketServer.
// Tests 2 + 3 use a per-test stub mounted via vi.doMock inside an
// importActual pattern, so they run in the same file without leaking the
// stub into test 1.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
} from 'undici';
import type { Dispatcher } from 'undici';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'net';

const WS_ID = 'ws-1';
const TOKEN = 'tok';
const INT_NAME = 'feishu-prod';
const INT_ID = 'int-uuid-1';

let savedDispatcher: Dispatcher;
let mockAgent: MockAgent;

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

/**
 * Build a fake `ws` module export: a class that records handlers per event
 * and exposes them so tests can trigger 'close'/'error'/'open' on demand.
 */
function makeWsStub() {
  type Handler = (...args: unknown[]) => void;
  const instances: Array<{
    handlers: Map<string, Handler[]>;
    closed: boolean;
    fire: (ev: string, ...args: unknown[]) => void;
  }> = [];
  class FakeWS {
    handlers = new Map<string, Handler[]>();
    closed = false;
    constructor() {
      const ref = this;
      instances.push({
        handlers: ref.handlers,
        closed: false,
        fire(ev, ...args) {
          for (const h of ref.handlers.get(ev) ?? []) h(...args);
        },
      });
    }
    on(ev: string, fn: Handler) {
      if (!this.handlers.has(ev)) this.handlers.set(ev, []);
      this.handlers.get(ev)!.push(fn);
      return this;
    }
    removeAllListeners(ev?: string) {
      if (ev) this.handlers.delete(ev);
      else this.handlers.clear();
    }
    close() {
      this.closed = true;
    }
  }
  return { FakeWS, instances };
}

describe('MulticaConfigSource · resilience (M-6)', () => {
  beforeEach(() => {
    savedDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
    vi.resetModules();
  });

  afterEach(async () => {
    await mockAgent.close();
    setGlobalDispatcher(savedDispatcher);
    vi.doUnmock('ws');
    vi.resetModules();
  });

  it('WS drop → client reconnects within 6s', async () => {
    // Real ws module here (no doMock for 'ws').
    const wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as AddressInfo).port;

    // Route HTTP through MockAgent at the same host:port we point WS at.
    const httpHost = `http://127.0.0.1:${port}`;
    const pool = mockAgent.get(httpHost);
    pool
      .intercept({ path: '/api/integrations?kind=mcp-server', method: 'GET' })
      .reply(200, intResponse(1, {}))
      .persist();

    let connectCount = 0;
    wss.on('connection', (sock) => {
      connectCount += 1;
      if (connectCount === 1) {
        // Drop first connection immediately to trigger reconnect.
        sock.close();
      }
    });

    const { MulticaConfigSource } = await import('../src/multica.js');
    const s = new MulticaConfigSource({
      serverUrl: httpHost,
      serviceToken: TOKEN,
      workspaceId: WS_ID,
      integrationName: INT_NAME,
      kind: 'mcp-server',
      pollIntervalMs: 60_000_000,
    });

    await s.start();

    const deadline = Date.now() + 6_500;
    while (connectCount < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(connectCount).toBeGreaterThanOrEqual(2);

    await s.stop();
    await new Promise<void>((r) => wss.close(() => r()));
  }, 15_000);

  it('5 consecutive WS failures → backoff capped at 60s', async () => {
    const { FakeWS, instances } = makeWsStub();
    vi.doMock('ws', () => ({ default: FakeWS }));
    // Re-import the SUT so it picks up the stubbed ws.
    const { MulticaConfigSource } = await import('../src/multica.js');

    // MockAgent so start()'s first pull succeeds.
    const pool = mockAgent.get('http://multica.test');
    pool
      .intercept({ path: '/api/integrations?kind=mcp-server', method: 'GET' })
      .reply(200, intResponse(1, {}))
      .persist();

    vi.useFakeTimers({ shouldAdvanceTime: false });
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    try {
      const s = new MulticaConfigSource({
        serverUrl: 'http://multica.test',
        serviceToken: TOKEN,
        workspaceId: WS_ID,
        integrationName: INT_NAME,
        kind: 'mcp-server',
        pollIntervalMs: 60_000_000,
      });

      // start() awaits the first pull, then calls connectWebSocket (sync)
      // which creates the FakeWS instance.
      await s.start();

      // Trigger 5 consecutive close cycles. Each close → 'error' bumps
      // wsFailures, then 'close' schedules a reconnect via setTimeout. The
      // reconnect creates the next FakeWS instance, then we close that too.
      const expectedDelays: number[] = [];
      const BACKOFF = [5_000, 10_000, 20_000, 40_000, 60_000];
      for (let i = 0; i < 5; i++) {
        const inst = instances[i]!;
        // Simulate 'error' then 'close' on the current socket.
        for (const h of inst.handlers.get('error') ?? []) h();
        for (const h of inst.handlers.get('close') ?? []) h();
        const idx = Math.min(i + 1, BACKOFF.length - 1);
        expectedDelays.push(BACKOFF[idx]!);
        // Run the scheduled reconnect synchronously so the next FakeWS is
        // created before we loop to it.
        vi.advanceTimersByTime(BACKOFF[idx]!);
      }

      // Six FakeWS instances total: 1 from start() + 5 reconnects.
      expect(instances.length).toBe(6);

      // Filter setTimeout calls that came from the impl's reconnect logic.
      // Those use the BACKOFF table; ignore unrelated ones (e.g. pollTimer
      // uses setInterval).
      const reconnectDelays = setTimeoutSpy.mock.calls
        .map((c) => c[1] as number)
        .filter((d) => BACKOFF.includes(d));

      expect(reconnectDelays).toEqual(expectedDelays);
      // The last (5th) failure scheduled the 60 s cap.
      expect(reconnectDelays.at(-1)).toBe(60_000);

      await s.stop();
    } finally {
      setTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('poll endpoint 500 → does not crash, last config still served', async () => {
    const { FakeWS } = makeWsStub();
    vi.doMock('ws', () => ({ default: FakeWS }));
    const { MulticaConfigSource } = await import('../src/multica.js');

    const pool = mockAgent.get('http://multica.test');
    pool
      .intercept({ path: '/api/integrations?kind=mcp-server', method: 'GET' })
      .reply(200, intResponse(1, { K: 'v1' }));
    pool
      .intercept({ path: '/api/integrations?kind=mcp-server', method: 'GET' })
      .reply(500, 'boom');

    const errSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const s = new MulticaConfigSource({
      serverUrl: 'http://multica.test',
      serviceToken: TOKEN,
      workspaceId: WS_ID,
      integrationName: INT_NAME,
      kind: 'mcp-server',
      pollIntervalMs: 60_000_000,
    });

    await s.start();
    expect(s.get('K')).toBe('v1');

    // Drive a second pull manually — mirrors what the poll timer would do.
    // Production code catches errors inside the setInterval callback;
    // calling pull() directly will reject, but the inner catch in start()
    // is what we're modelling.
    await (s as unknown as { pull: () => Promise<void> })
      .pull()
      .catch(() => {});

    expect(s.get('K')).toBe('v1');
    expect(s.version()).toBe(1);

    await s.stop();
    errSpy.mockRestore();
  });
});
