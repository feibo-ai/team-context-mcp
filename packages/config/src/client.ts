// packages/config/src/client.ts
//
// Thin REST client for multica's control plane (Plan-4 D-1..D-8 endpoints).
// Used by MulticaConfigSource (M-5) for pull-based config + secret reads,
// by the bearer-validation path (M-16) via me(), and by the health endpoint
// (M-17) via ping().
import { request } from 'undici';

export interface MulticaControlPlaneClientOptions {
  serverUrl: string;
  serviceToken: string;
  workspaceId: string;
}

export interface Integration {
  id: string;
  kind: string;
  name: string;
  config: Record<string, unknown>;
  version: number;
  status: string;
}

export class MulticaControlPlaneClient {
  constructor(private opts: MulticaControlPlaneClientOptions) {}

  private async req<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const res = await request(`${this.opts.serverUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.opts.serviceToken}`,
        'X-Workspace-Id': this.opts.workspaceId,
        'Content-Type': 'application/json',
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    if (res.statusCode === 401) throw new Error('multica auth failed');
    if (res.statusCode >= 400) {
      const text = await res.body.text();
      throw new Error(`multica ${res.statusCode}: ${text}`);
    }
    return (await res.body.json()) as T;
  }

  /**
   * GET /api/me — used by M-16 to validate a user-supplied bearer token,
   * and by M-17 health check as a multica reachability ping.
   */
  me(): Promise<{ id: string; email: string }> {
    return this.req<{ id: string; email: string }>('/api/me');
  }

  /** Reachability probe for health endpoint (M-17). Returns true if 2xx. */
  async ping(): Promise<boolean> {
    try {
      await this.me();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find an integration by its `name` field. multica has no /by-name/{name}
   * route — only `GET /api/integrations/{id}` and `GET /api/integrations?kind=X`
   * (workspace-scoped list). We do client-side filtering.
   *
   * Pass `kind` to shrink the list (5-person team → ≤10 integrations → ~1 KB,
   * single round trip is fine).
   */
  async getIntegrationByName(name: string, kind?: string): Promise<Integration> {
    const q = kind ? `?kind=${encodeURIComponent(kind)}` : '';
    const list = await this.req<Integration[]>(`/api/integrations${q}`);
    const found = list.find((i) => i.name === name);
    if (!found) {
      throw new Error(
        `integration not found: name=${name}${kind ? ` kind=${kind}` : ''}`,
      );
    }
    return found;
  }

  getSecret(
    integrationId: string,
    key: string,
  ): Promise<{ value: string; version: number }> {
    return this.req<{ value: string; version: number }>(
      `/api/integrations/${integrationId}/secrets/${encodeURIComponent(key)}`,
    );
  }

  registerDeployment(params: {
    integration_id: string;
    image_or_commit: string;
    host_url?: string;
    version: number;
  }): Promise<{ id: string }> {
    return this.req<{ id: string }>('/api/deployments', {
      method: 'POST',
      body: params,
    });
  }

  heartbeat(
    deploymentId: string,
    configVersion: number,
    status?: string,
  ): Promise<void> {
    return this.req<void>(`/api/deployments/${deploymentId}/heartbeat`, {
      method: 'POST',
      body: { config_applied_version: configVersion, status },
    });
  }
}
