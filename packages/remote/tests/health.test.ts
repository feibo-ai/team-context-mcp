import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  healthHandler,
  type HealthDeps,
  type HealthResponse,
} from '../src/health.js';

// Minimal `res` stand-in: capture whatever `res.json()` was called with.
// The handler never touches anything else on the response object.
function makeRes() {
  const captured: { body?: HealthResponse } = {};
  const res = {
    json(body: HealthResponse) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}

const req = {} as Request;
const next = vi.fn();

// Anonymous classes give us a non-empty `constructor.name` to assert on,
// matching how a real `MulticaConfigSource` / `EnvConfigSource` would appear.
class FakeMulticaConfigSource {
  version() {
    return 7;
  }
}

function baseDeps(overrides: Partial<HealthDeps> = {}): HealthDeps {
  return {
    configSource: new FakeMulticaConfigSource(),
    multica: { ping: async () => true, controlPlaneOk: true },
    feishu: { ping: async () => undefined },
    ...overrides,
  };
}

describe('healthHandler', () => {
  it('returns healthy + all flags true when every dep is up', async () => {
    const handler = healthHandler(baseDeps());
    const { res, captured } = makeRes();
    await handler(req, res, next);

    expect(captured.body).toMatchObject({
      status: 'healthy',
      multica_reachable: true,
      feishu_ready: true,
      multica_control_plane_enabled: true,
      config_version: 7,
      config_source: 'FakeMulticaConfigSource',
    });
    expect(typeof captured.body!.uptime_seconds).toBe('number');
    expect(captured.body!.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(captured.body!.version).toBe(process.env.GIT_SHA ?? 'unknown');
  });

  it('marks status degraded when multica.ping throws', async () => {
    const handler = healthHandler(
      baseDeps({
        multica: {
          ping: async () => {
            throw new Error('connection refused');
          },
          controlPlaneOk: true,
        },
      }),
    );
    const { res, captured } = makeRes();
    await handler(req, res, next);

    expect(captured.body).toMatchObject({
      status: 'degraded',
      multica_reachable: false,
      // control_plane_enabled is independent of reachability — it's the boot
      // signal. A boot-time success followed by a transient outage should
      // still show enabled=true, reachable=false.
      multica_control_plane_enabled: true,
    });
  });

  it('marks status degraded when multica.ping returns false (auth fail)', async () => {
    // MulticaControlPlaneClient.ping() returns false on 401, not throw.
    const handler = healthHandler(
      baseDeps({
        multica: { ping: async () => false, controlPlaneOk: true },
      }),
    );
    const { res, captured } = makeRes();
    await handler(req, res, next);

    expect(captured.body).toMatchObject({
      status: 'degraded',
      multica_reachable: false,
    });
  });

  it('stays healthy when feishu.ping is missing or fails (multica is the gate)', async () => {
    // Sub-case 1: feishu has no ping() method at all (current FeishuClient).
    const handlerNoPing = healthHandler(
      baseDeps({ feishu: {} as HealthDeps['feishu'] }),
    );
    const { res: res1, captured: cap1 } = makeRes();
    await handlerNoPing(req, res1, next);
    expect(cap1.body).toMatchObject({
      status: 'healthy',
      feishu_ready: false,
      multica_reachable: true,
    });

    // Sub-case 2: feishu.ping() throws.
    const handlerThrows = healthHandler(
      baseDeps({
        feishu: {
          ping: async () => {
            throw new Error('feishu down');
          },
        },
      }),
    );
    const { res: res2, captured: cap2 } = makeRes();
    await handlerThrows(req, res2, next);
    expect(cap2.body).toMatchObject({
      status: 'healthy',
      feishu_ready: false,
      multica_reachable: true,
    });
  });

  it('reports multica_control_plane_enabled=false when boot failed', async () => {
    // Mirrors the case where ConfigSource.start() threw (404 — integration
    // not registered). server.ts sets controlPlaneOk=false in that branch.
    const handler = healthHandler(
      baseDeps({
        multica: { ping: async () => true, controlPlaneOk: false },
      }),
    );
    const { res, captured } = makeRes();
    await handler(req, res, next);

    expect(captured.body).toMatchObject({
      status: 'healthy',
      multica_reachable: true,
      multica_control_plane_enabled: false,
    });
  });

  it('surfaces deployment stats when tracker is wired (P3 follow-up)', async () => {
    // When server.ts spawns a DeploymentTracker (integration_id resolved),
    // /health should report its register status + beat counters so the DRI
    // can answer "is multica seeing this deployment?" without grepping logs.
    const handler = healthHandler(
      baseDeps({
        deployment: {
          getStats: () => ({
            registered: true,
            deploymentId: 'dep_abc123',
            beatsSucceeded: 42,
            beatsFailed: 1,
            lastError: 'heartbeat 503',
          }),
        },
      }),
    );
    const { res, captured } = makeRes();
    await handler(req, res, next);

    expect(captured.body!.deployment).toEqual({
      registered: true,
      deployment_id: 'dep_abc123',
      beats_succeeded: 42,
      beats_failed: 1,
      last_error: 'heartbeat 503',
    });
  });

  it('omits deployment field when no tracker is passed', async () => {
    // Backwards-compat path: existing health.ts callers (and the env-only
    // bootstrap path where integrationId is unresolved) don't pass deployment.
    const handler = healthHandler(baseDeps());
    const { res, captured } = makeRes();
    await handler(req, res, next);

    expect(captured.body!.deployment).toBeUndefined();
  });
});
