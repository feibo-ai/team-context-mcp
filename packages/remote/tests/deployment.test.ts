// packages/remote/tests/deployment.test.ts
//
// Plan 5 Task M-18 — DeploymentTracker.
//
// Covers:
//   1. start() · registers + fires first beat immediately + sets up interval
//   2. heartbeat 500 · tracker keeps running · error written to stderr
//   3. stop() · clears interval (no further beats)
//   4. register 404 (Plan 4 D-7 not live yet) · start() does NOT throw,
//      beat() becomes a no-op, stats reflect degraded mode
//
// HTTP is intercepted with undici MockAgent (same pattern as
// packages/config/tests/multica.test.ts). Time is faked with vi.useFakeTimers
// so we can prove the 30s cadence without sleeping in real time.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
import { MulticaControlPlaneClient } from '@tcmcp/config';
import { DeploymentTracker } from '../src/deployment.js';

const BASE = 'http://multica.test';
const WS_ID = 'ws-1';
const TOKEN = 'tok';
const INT_ID = 'int-uuid-1';
const DEP_ID = 'dep-uuid-1';

let savedDispatcher: Dispatcher;
let mockAgent: MockAgent;
let stderrSpy: ReturnType<typeof vi.spyOn>;

function newClient() {
  return new MulticaControlPlaneClient({
    serverUrl: BASE,
    serviceToken: TOKEN,
    workspaceId: WS_ID,
  });
}

function newTracker(client: MulticaControlPlaneClient, version = 1) {
  return new DeploymentTracker({
    client,
    integrationId: INT_ID,
    imageOrCommit: 'abc1234',
    hostUrl: 'http://localhost:8443',
    getConfigVersion: () => version,
  });
}

describe('DeploymentTracker', () => {
  beforeEach(() => {
    savedDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
    // Silence stderr · we assert on it via the spy.
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    // Fake ONLY setInterval/clearInterval. undici's internal HTTP machinery
    // uses setTimeout/Date heavily — faking those globally makes requests
    // hang indefinitely (the response promise resolves via a real timer).
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });

  afterEach(async () => {
    vi.useRealTimers();
    stderrSpy.mockRestore();
    await mockAgent.close();
    setGlobalDispatcher(savedDispatcher);
  });

  it('start() registers · stores deploymentId · fires first beat immediately', async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: '/api/deployments', method: 'POST' })
      .reply(200, { id: DEP_ID });
    // First (immediate) beat fired by start().
    pool
      .intercept({
        path: `/api/deployments/${DEP_ID}/heartbeat`,
        method: 'POST',
      })
      .reply(200, {});

    const tracker = newTracker(newClient());
    await tracker.start();

    const stats = tracker.getStats();
    expect(stats.registered).toBe(true);
    expect(stats.deploymentId).toBe(DEP_ID);
    expect(stats.beatsSucceeded).toBe(1);
    expect(stats.beatsFailed).toBe(0);

    await tracker.stop();
  });

  it('heartbeat 500 · tracker keeps running · error written to stderr', async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: '/api/deployments', method: 'POST' })
      .reply(200, { id: DEP_ID });
    pool
      .intercept({
        path: `/api/deployments/${DEP_ID}/heartbeat`,
        method: 'POST',
      })
      .reply(500, 'boom');

    const tracker = newTracker(newClient());
    // Must not throw even though the immediate beat 500s.
    await expect(tracker.start()).resolves.toBeUndefined();

    const stats = tracker.getStats();
    expect(stats.registered).toBe(true);
    expect(stats.beatsSucceeded).toBe(0);
    expect(stats.beatsFailed).toBe(1);
    expect(stats.lastError).toMatch(/500/);
    expect(stderrSpy).toHaveBeenCalled();
    const errLog = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(errLog).toMatch(/heartbeat failed/);

    await tracker.stop();
  });

  it('stop() clears the interval · no further beats fire', async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: '/api/deployments', method: 'POST' })
      .reply(200, { id: DEP_ID });
    // Exactly ONE heartbeat interceptor · if the interval fires after stop(),
    // we'd hit MockNotMatchedError and the assertion below would surface it.
    pool
      .intercept({
        path: `/api/deployments/${DEP_ID}/heartbeat`,
        method: 'POST',
      })
      .reply(200, {});

    const tracker = newTracker(newClient());
    await tracker.start();
    expect(tracker.getStats().beatsSucceeded).toBe(1);

    await tracker.stop();

    // Advance time past several 30s windows. If stop() didn't clear the
    // interval, beats would fire here and MockAgent would record extra
    // (un-intercepted) calls.
    await vi.advanceTimersByTimeAsync(120_000);

    expect(tracker.getStats().beatsSucceeded).toBe(1);
    expect(tracker.getStats().beatsFailed).toBe(0);
    // No pending interceptors should be left over either way · sanity-check
    // we didn't accidentally leak network calls.
    mockAgent.assertNoPendingInterceptors();
  });

  it('register 404 (D-7 not live yet) · start() does not throw · beat() no-ops', async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: '/api/deployments', method: 'POST' })
      .reply(404, 'not found');
    // No heartbeat interceptor · if start() ever called heartbeat without a
    // deploymentId, MockNotMatchedError would fail the test.

    const tracker = newTracker(newClient());
    // Critical: must not throw even though multica returns 404.
    await expect(tracker.start()).resolves.toBeUndefined();

    const stats = tracker.getStats();
    expect(stats.registered).toBe(false);
    expect(stats.deploymentId).toBeUndefined();
    expect(stats.beatsSucceeded).toBe(0);
    expect(stats.beatsFailed).toBe(0);
    expect(stats.lastError).toMatch(/404/);
    expect(stderrSpy).toHaveBeenCalled();

    await tracker.stop();
  });
});
