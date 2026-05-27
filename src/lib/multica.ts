import { request } from 'undici';
import type { MulticaIssue } from '../types.js';

export interface MulticaConfig {
  serverUrl: string;
  token: string;
  workspaceId: string;
}

export interface CreateIssueParams {
  title: string;
  body?: string;
  labels?: string[];
  projectId?: string;
  assigneeId?: string;
  assigneeType?: 'member' | 'agent' | 'squad';
}

export class MulticaClient {
  constructor(private readonly cfg: MulticaConfig) {}

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

  createIssue(params: CreateIssueParams): Promise<MulticaIssue> {
    return this.req('/api/issues', { method: 'POST', body: params });
  }

  commentOnIssue(issueId: string, body: string): Promise<{ id: string }> {
    return this.req(`/api/issues/${issueId}/comments`, {
      method: 'POST',
      body: { body },
    });
  }

  addLabel(issueId: string, label: string): Promise<void> {
    return this.req(`/api/issues/${issueId}/labels`, {
      method: 'POST',
      body: { name: label },
    });
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
