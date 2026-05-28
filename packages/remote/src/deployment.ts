// packages/remote/src/deployment.ts
//
// Plan 5 Task M-18 — DeploymentTracker.
//
// On boot, the remote server POSTs to multica `/api/deployments` to register
// itself, then sends a heartbeat every 30s with the current applied config
// version. multica uses this to display "running" deployments in the
// integration detail view and to detect stale/abandoned instances.
//
// Failure policy: this is BEST-EFFORT telemetry. multica may legitimately be
// 404ing the endpoint (Plan 4 D-7 not live yet), 500ing, partitioned, or
// having a bad day. None of that should crash the MCP server — tools must
// keep serving. Errors are written to stderr and swallowed.
//
// Wiring into `server.ts` happens in M-19.
import type { MulticaControlPlaneClient } from '@tcmcp/config';

export interface DeploymentTrackerDeps {
  client: MulticaControlPlaneClient;
  integrationId: string;
  imageOrCommit: string;
  hostUrl?: string;
  getConfigVersion: () => number;
  /** Heartbeat cadence. Defaults to 30s — override only in tests. */
  heartbeatIntervalMs?: number;
}

/**
 * Tracks success/failure counts so an operator can sanity-check connectivity
 * via the health endpoint without grepping logs. Not in the plan but cheap.
 * TODO(M-17): expose via /health when M-17 wires up DeploymentTracker.
 */
export interface DeploymentStats {
  registered: boolean;
  deploymentId?: string;
  beatsSucceeded: number;
  beatsFailed: number;
  lastError?: string;
}

export class DeploymentTracker {
  private deploymentId?: string;
  private interval?: NodeJS.Timeout;
  private beatsSucceeded = 0;
  private beatsFailed = 0;
  private lastError?: string;

  constructor(private deps: DeploymentTrackerDeps) {}

  async start(): Promise<void> {
    try {
      const dep = await this.deps.client.registerDeployment({
        integration_id: this.deps.integrationId,
        image_or_commit: this.deps.imageOrCommit,
        host_url: this.deps.hostUrl,
        version: this.deps.getConfigVersion(),
      });
      this.deploymentId = dep.id;
    } catch (e) {
      // multica may not have D-7 live yet (404), or be temporarily down.
      // Swallow — tools must keep serving. No deploymentId means beat()
      // becomes a no-op, which is the correct degraded behavior.
      this.lastError = String(e);
      process.stderr.write(`deployment register failed: ${e}\n`);
    }

    const cadence = this.deps.heartbeatIntervalMs ?? 30_000;
    // Unref so the interval never blocks process exit during shutdown.
    this.interval = setInterval(() => {
      void this.beat();
    }, cadence);
    if (typeof this.interval.unref === 'function') this.interval.unref();

    // Kick one immediately so multica sees us before the first 30s tick.
    await this.beat();
  }

  private async beat(): Promise<void> {
    if (!this.deploymentId) return;
    try {
      await this.deps.client.heartbeat(
        this.deploymentId,
        this.deps.getConfigVersion(),
        'running',
      );
      this.beatsSucceeded++;
    } catch (e) {
      this.beatsFailed++;
      this.lastError = String(e);
      // log but don't crash · multica may be temporarily down
      process.stderr.write(`heartbeat failed: ${e}\n`);
    }
  }

  async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    // Optional: post final 'stopped' status. Not in the M-18 spec — skipped.
  }

  /** Debug helper. See {@link DeploymentStats}. */
  getStats(): DeploymentStats {
    return {
      registered: this.deploymentId !== undefined,
      deploymentId: this.deploymentId,
      beatsSucceeded: this.beatsSucceeded,
      beatsFailed: this.beatsFailed,
      lastError: this.lastError,
    };
  }
}
