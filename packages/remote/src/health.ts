// @tcmcp/remote — /health endpoint (Plan 5 M-17)
//
// Reports operational state of the three dependencies the remote needs to
// function. Returned shape is documented in plan-5 §M-17 (revised). Surfaces
// `config_source` (which ConfigSource is wired — env-only vs. layered vs.
// multica) so the DRI can diagnose "why is hot-reload not working" without
// SSH-ing into the box. `multica_control_plane_enabled` is set externally by
// server.ts based on whether ConfigSource.start() resolved (true) or threw
// (false — usually a 404 from /api/integrations/:id meaning the integration
// row was never created in multica).
//
// `status` rolls up to 'degraded' iff multica is unreachable; feishu being
// unready does NOT degrade health because feishu is a downstream side-effect
// (notify_team posts), not a request-path dependency. Wired into the express
// app in M-19; M-2's server.ts already accepts an optional `healthHandler`.

import type { RequestHandler } from 'express';

/** Subset of ConfigSource we need here. Real type is in `@tcmcp/config`. */
export interface HealthConfigSource {
  version(): number;
}

/** Subset of MulticaControlPlaneClient + control-plane-enabled flag. */
export interface HealthMulticaClient {
  ping?(): Promise<boolean>;
  controlPlaneOk?: boolean;
}

/** Subset of FeishuClient (ping is optional — not yet implemented as of M-17). */
export interface HealthFeishuClient {
  ping?(): Promise<unknown>;
}

export interface HealthDeps {
  configSource: HealthConfigSource;
  feishu: HealthFeishuClient;
  multica: HealthMulticaClient;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded';
  version: string;
  uptime_seconds: number;
  config_version: number;
  config_source: string;
  multica_control_plane_enabled: boolean;
  multica_reachable: boolean;
  feishu_ready: boolean;
}

export function healthHandler(deps: HealthDeps): RequestHandler {
  return async (_req, res) => {
    const out: HealthResponse = {
      status: 'healthy',
      version: process.env.GIT_SHA ?? 'unknown',
      uptime_seconds: process.uptime(),
      config_version: deps.configSource.version(),
      // Surface which ConfigSource is wired (helps DRI debug "why isn't
      // hot-reload working" — common cause: server fell back to env).
      config_source: deps.configSource.constructor.name,
      // True iff first pull succeeded (no 404). Set externally by server.ts
      // after start() resolves vs. throws.
      multica_control_plane_enabled: deps.multica.controlPlaneOk ?? false,
      multica_reachable: false,
      feishu_ready: false,
    };
    try {
      // MulticaControlPlaneClient.ping() returns false on auth failure rather
      // than throwing — coerce both paths to the same outcome here.
      const reachable = await deps.multica.ping?.();
      out.multica_reachable = reachable === true;
    } catch {
      out.multica_reachable = false;
    }
    try {
      await deps.feishu.ping?.();
      out.feishu_ready = typeof deps.feishu.ping === 'function';
    } catch {
      out.feishu_ready = false;
    }
    if (!out.multica_reachable) out.status = 'degraded';
    res.json(out);
  };
}
