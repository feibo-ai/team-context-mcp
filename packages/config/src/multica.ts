// packages/config/src/multica.ts
//
// Production ConfigSource that pulls config + secrets from a multica control
// plane and subscribes to its WebSocket for live `integration:config-changed`
// events (Plan-4 D-8). Poll loop is a safety net for missed events.
//
// M-6 resilience: WS reconnect uses exponential backoff (5s → 10s → 20s →
// 40s → 60s cap) keyed on consecutive failures. Poll failures are logged and
// last-known config keeps serving — process never crashes.
import WebSocket from 'ws';
import type { ConfigSource } from './source.js';
import { MulticaControlPlaneClient } from './client.js';

export interface MulticaSourceOptions {
  serverUrl: string;
  serviceToken: string;
  /** Required — WS event channel is workspace-scoped. */
  workspaceId: string;
  integrationName: string;
  /** Optional kind hint (e.g. 'mcp-server') to shrink the list query. */
  kind?: string;
  /** Poll safety net interval. Default 30 s. */
  pollIntervalMs?: number;
  /** Secret cache TTL. Default 5 min. Set 0 to bypass (full audit fidelity). */
  secretCacheTtlMs?: number;
}

/** Exponential backoff schedule for WS reconnect (ms). Caps at 60 s. */
const RECONNECT_BACKOFF_MS = [5_000, 10_000, 20_000, 40_000, 60_000];

export class MulticaConfigSource implements ConfigSource {
  private client: MulticaControlPlaneClient;
  private integrationId?: string;
  private currentVersion = 0;
  private configCache = new Map<string, unknown>();
  private secretCache = new Map<string, { value: string; fetchedAt: number }>();
  private listeners = new Set<(k: string) => void>();
  private ws?: WebSocket;
  private pollTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private wsFailures = 0;
  private stopped = false;

  constructor(private opts: MulticaSourceOptions) {
    this.client = new MulticaControlPlaneClient({
      serverUrl: opts.serverUrl,
      serviceToken: opts.serviceToken,
      workspaceId: opts.workspaceId,
    });
  }

  async start(): Promise<void> {
    // First pull doubles as a control-plane probe. If multica is configured
    // with MULTICA_CONTROL_PLANE_ENABLED=false the /api/integrations routes
    // are not mounted → 404. Surface a precise hint instead of letting
    // downstream tools fail mysteriously when they read missing config.
    try {
      await this.pull();
    } catch (e: unknown) {
      if (String(e).includes('404')) {
        throw new Error(
          `multica control plane disabled (got 404 on /api/integrations). ` +
            `Set MULTICA_CONTROL_PLANE_ENABLED=true on the multica server, ` +
            `or wire LayeredConfigSource([new EnvConfigSource()]) for env-only mode.`,
        );
      }
      throw e;
    }
    this.connectWebSocket();
    this.pollTimer = setInterval(
      () =>
        this.pull().catch((err) =>
          process.stderr.write(`pull failed: ${err}\n`),
        ),
      this.opts.pollIntervalMs ?? 30_000,
    );
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      // Drop reconnect listener before closing so stop() is final.
      this.ws.removeAllListeners('close');
      this.ws.close();
    }
  }

  private async pull(): Promise<void> {
    const integration = await this.client.getIntegrationByName(
      this.opts.integrationName,
      this.opts.kind,
    );
    this.integrationId = integration.id;
    const newVersion = integration.version;
    const changed = newVersion !== this.currentVersion;
    this.currentVersion = newVersion;
    this.configCache.clear();
    for (const [k, v] of Object.entries(integration.config)) {
      this.configCache.set(k, v);
    }
    // Bust secret cache on version change (secrets may have rotated).
    if (changed) {
      this.secretCache.clear();
      this.fireChangeAll();
    }
  }

  private connectWebSocket(): void {
    if (this.stopped) return;
    // WS is workspace-scoped (Broadcaster.BroadcastToWorkspace). Include
    // workspace_id query param so multica routes the right channel events.
    const wsUrl =
      this.opts.serverUrl.replace(/^http/, 'ws') +
      `/api/events?token=${encodeURIComponent(this.opts.serviceToken)}` +
      `&workspace_id=${encodeURIComponent(this.opts.workspaceId)}`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.on('open', () => {
      this.wsFailures = 0;
    });

    ws.on('message', (data) => {
      try {
        const ev = JSON.parse(data.toString());
        // Event name uses colon (matches multica convention `issue:created`
        // etc). Payload fields are snake_case per Plan-4 D-8: integration_id
        // / integration_name / kind / new_version / workspace_id.
        if (
          ev.type === 'integration:config-changed' &&
          ev.integration_id === this.integrationId
        ) {
          this.pull().catch((err) =>
            process.stderr.write(`ws-triggered pull failed: ${err}\n`),
          );
        }
      } catch {
        /* ignore malformed */
      }
    });

    ws.on('error', () => {
      // 'error' always precedes 'close'; bump the counter once.
      this.wsFailures += 1;
    });

    ws.on('close', () => {
      if (this.stopped) return;
      const idx = Math.min(
        this.wsFailures,
        RECONNECT_BACKOFF_MS.length - 1,
      );
      const delay = RECONNECT_BACKOFF_MS[idx]!;
      this.reconnectTimer = setTimeout(() => this.connectWebSocket(), delay);
    });
  }

  get<T = unknown>(key: string): T | undefined {
    return this.configCache.get(key) as T | undefined;
  }

  /**
   * NOTE — every cache miss triggers a multica audit_logs row (Plan-4 D-15:
   * event_type=`secret:read`). The 5-min TTL (secretCacheTtlMs) trades audit
   * noise for performance. For compliance-grade every-call audit, construct
   * with `{ secretCacheTtlMs: 0 }` to bypass the cache.
   */
  async getSecret(key: string): Promise<string | undefined> {
    if (!this.integrationId) throw new Error('MulticaConfigSource not started');
    const ttl = this.opts.secretCacheTtlMs ?? 5 * 60_000;
    const cached = this.secretCache.get(key);
    if (ttl > 0 && cached && Date.now() - cached.fetchedAt < ttl) {
      return cached.value;
    }
    try {
      const s = await this.client.getSecret(this.integrationId, key);
      this.secretCache.set(key, { value: s.value, fetchedAt: Date.now() });
      return s.value;
    } catch (e) {
      if (String(e).includes('404')) return undefined;
      throw e;
    }
  }

  version(): number {
    return this.currentVersion;
  }

  onChange(callback: (k: string) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private fireChangeAll(): void {
    for (const cb of this.listeners) cb('*');
  }
}
