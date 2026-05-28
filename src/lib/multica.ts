import { request } from 'undici';
import type { MulticaIssue } from '@tcmcp/shared';

export interface MulticaConfig {
  serverUrl: string;
  token: string;
  workspaceId: string;
  /**
   * Optional pre-seeded {label name → label UUID} map. Production code can
   * skip this and let the client lazy-load via GET /api/labels. Tests that
   * mock with undici MockAgent should pass this so they don't have to
   * intercept the label lookup.
   */
  labelMap?: Record<string, string>;
}

export interface CreateIssueParams {
  title: string;
  body?: string;
  labels?: string[];
  projectId?: string;
  assigneeId?: string;
  assigneeType?: 'member' | 'agent' | 'squad';
}

interface LabelRow {
  id: string;
  name: string;
}

export class MulticaClient {
  private labelCache?: Map<string, string>;

  constructor(private readonly cfg: MulticaConfig) {
    if (cfg.labelMap) {
      this.labelCache = new Map(Object.entries(cfg.labelMap));
    }
  }

  private async req<T>(
    path: string,
    init: { method?: string; body?: unknown } = {}
  ): Promise<T> {
    const res = await request(`${this.cfg.serverUrl}${path}`, {
      method: init.method || 'GET',
      headers: {
        Authorization: `Bearer ${this.cfg.token}`,
        'Content-Type': 'application/json',
        'X-Workspace-Id': this.cfg.workspaceId,
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

    if (res.statusCode === 401) {
      throw new Error(
        'multica auth failed (401). Run: multica login'
      );
    }
    if (res.statusCode >= 400) {
      const text = await res.body.text();
      throw new Error(`multica API ${res.statusCode}: ${text}`);
    }
    return (await res.body.json()) as T;
  }

  me(): Promise<{ id: string; email: string }> {
    return this.req('/api/me');
  }

  /**
   * POST /api/issues — multica accepts `description` (not `body`) and silently
   * drops `labels` at create time. Labels must be added post-create via the
   * separate /api/issues/{id}/labels endpoint, which itself requires a
   * `label_id` UUID rather than a name (hence the label cache).
   */
  async createIssue(params: CreateIssueParams): Promise<MulticaIssue> {
    const { body, labels, ...rest } = params;
    const issue = await this.req<MulticaIssue>('/api/issues', {
      method: 'POST',
      body: { ...rest, description: body },
    });
    if (labels && labels.length > 0) {
      for (const name of labels) {
        await this.addLabel(issue.id, name);
      }
    }
    return issue;
  }

  commentOnIssue(issueId: string, body: string): Promise<{ id: string }> {
    return this.req(`/api/issues/${issueId}/comments`, {
      method: 'POST',
      body: { body },
    });
  }

  /**
   * POST /api/issues/{id}/labels needs `{ label_id: <uuid> }`. We resolve the
   * name → id via the workspace label list (cached on first lookup).
   */
  async addLabel(issueId: string, labelName: string): Promise<void> {
    const labelId = await this.getLabelId(labelName);
    await this.req(`/api/issues/${issueId}/labels`, {
      method: 'POST',
      body: { label_id: labelId },
    });
  }

  private async getLabelId(name: string): Promise<string> {
    if (!this.labelCache) {
      const rows = await this.listLabels();
      this.labelCache = new Map(rows.map((r) => [r.name, r.id]));
    }
    const id = this.labelCache.get(name);
    if (!id) {
      throw new Error(`unknown label "${name}" — create it in multica first (multica label create --name "${name}" --color "#XXXXXX")`);
    }
    return id;
  }

  async listLabels(): Promise<LabelRow[]> {
    const raw = await this.req<LabelRow[] | { labels: LabelRow[] }>('/api/labels');
    return Array.isArray(raw) ? raw : raw.labels ?? [];
  }

  getIssue(issueId: string): Promise<MulticaIssue> {
    return this.req(`/api/issues/${issueId}`);
  }

  listSkills(): Promise<Array<{ id: string; name: string; bodyTokens?: number; ownerEmail?: string }>> {
    return this.req('/api/skills');
  }

  getIssueRuns(issueId: string): Promise<Array<{ id: string; createdAt: string; status: string }>> {
    return this.req(`/api/issues/${issueId}/runs`);
  }
}
