import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { MulticaClient } from '../src/multica-client.js';
import { STANDARD_LABEL_MAP, interceptAnyLabelAdd } from '../src/test-helpers/multica-mock.js';

const here = dirname(fileURLToPath(import.meta.url));
const issueFixture = readFileSync(
  resolve(here, 'fixtures/multica-issue-create.json'),
  'utf-8'
);

describe('MulticaClient', () => {
  let mockAgent: MockAgent;
  let originalDispatcher: ReturnType<typeof getGlobalDispatcher>;

  beforeEach(() => {
    originalDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  afterEach(async () => {
    setGlobalDispatcher(originalDispatcher);
    await mockAgent.close();
  });

  it('createIssue posts and returns parsed issue', async () => {
    const pool = mockAgent.get('http://multica.test');
    pool.intercept({ path: '/api/issues', method: 'POST' }).reply(201, JSON.parse(issueFixture));
    interceptAnyLabelAdd(pool);

    const client = new MulticaClient({
      serverUrl: 'http://multica.test',
      token: 'mul_test',
      workspaceId: 'ws_test',
      labelMap: STANDARD_LABEL_MAP,
    });

    const issue = await client.createIssue({
      title: 'Plan: feed latency',
      labels: ['plan-draft'],
      projectId: 'proj_xyz',
    });

    expect(issue.id).toBe('issue_abc123');
    // Note: real multica /api/issues response does NOT include labels (they
    // get attached via separate POST /labels). The fixture's labels[] is
    // informational only; the assertion here is that the issue id round-trips.
  });

  it('createIssue converts camelCase projectId/assigneeId/assigneeType to snake_case', async () => {
    const pool = mockAgent.get('http://multica.test');
    let sentBody: Record<string, unknown> = {};
    pool
      .intercept({ path: '/api/issues', method: 'POST' })
      .reply(201, (opts: { body?: string }) => {
        sentBody = JSON.parse(opts.body ?? '{}');
        return JSON.parse(issueFixture);
      });
    interceptAnyLabelAdd(pool);

    const client = new MulticaClient({
      serverUrl: 'http://multica.test',
      token: 'mul_test',
      workspaceId: 'ws_test',
      labelMap: STANDARD_LABEL_MAP,
    });

    await client.createIssue({
      title: 'x',
      projectId: 'proj_xyz',
      assigneeId: 'agent_1',
      assigneeType: 'agent',
    });

    // Backend (Go) expects snake_case and silently drops unknown camelCase.
    expect(sentBody.project_id).toBe('proj_xyz');
    expect(sentBody.assignee_id).toBe('agent_1');
    expect(sentBody.assignee_type).toBe('agent');
    expect(sentBody.projectId).toBeUndefined();
    expect(sentBody.assigneeId).toBeUndefined();
    expect(sentBody.assigneeType).toBeUndefined();
  });

  it('throws on 401 with helpful message', async () => {
    mockAgent
      .get('http://multica.test')
      .intercept({ path: '/api/me', method: 'GET' })
      .reply(401, { error: 'Token is invalid or expired' });

    const client = new MulticaClient({
      serverUrl: 'http://multica.test',
      token: 'mul_bad',
      workspaceId: 'ws_test',
    });

    await expect(client.me()).rejects.toThrow(/multica login/i);
  });

  it('removeLabel DELETEs /api/issues/{id}/labels/{labelId} (resolved name→id)', async () => {
    const pool = mockAgent.get('http://multica.test');
    let deletedPath = '';
    pool
      .intercept({
        path: (p: string) => p.startsWith('/api/issues/iss1/labels/'),
        method: 'DELETE',
      })
      .reply(200, (opts: { path?: string }) => {
        deletedPath = opts.path ?? '';
        return {}; // backend returns 200 + JSON (writeJSON StatusOK), not 204
      });

    const client = new MulticaClient({
      serverUrl: 'http://multica.test',
      token: 't',
      workspaceId: 'w',
      labelMap: STANDARD_LABEL_MAP,
    });
    await client.removeLabel('iss1', '计划-草稿');
    expect(deletedPath).toBe(`/api/issues/iss1/labels/${STANDARD_LABEL_MAP['计划-草稿']}`);
  });

  it('removeLabel is idempotent: backend 404 (not attached) does not throw', async () => {
    const pool = mockAgent.get('http://multica.test');
    pool
      .intercept({
        path: (p: string) => p.startsWith('/api/issues/iss1/labels/'),
        method: 'DELETE',
      })
      .reply(404, { error: 'label not found' });

    const client = new MulticaClient({
      serverUrl: 'http://multica.test',
      token: 't',
      workspaceId: 'w',
      labelMap: STANDARD_LABEL_MAP,
    });
    await expect(client.removeLabel('iss1', '计划-草稿')).resolves.toBeUndefined();
  });

  it('removeLabel is a no-op for an unknown label name (no request made)', async () => {
    // No DELETE intercept registered — disableNetConnect would throw if a
    // request were attempted, proving the unknown name short-circuits.
    const client = new MulticaClient({
      serverUrl: 'http://multica.test',
      token: 't',
      workspaceId: 'w',
      labelMap: STANDARD_LABEL_MAP,
    });
    await expect(client.removeLabel('iss1', 'no-such-label')).resolves.toBeUndefined();
  });

  it('commentOnIssue posts `content` (not `body`) — backend rejects `body` with 400', async () => {
    const pool = mockAgent.get('http://multica.test');
    let sent: Record<string, unknown> = {};
    pool
      .intercept({ path: '/api/issues/iss1/comments', method: 'POST' })
      .reply(201, (opts: { body?: string }) => {
        sent = JSON.parse(opts.body ?? '{}');
        return { id: 'cmt1' };
      });

    const client = new MulticaClient({
      serverUrl: 'http://multica.test',
      token: 't',
      workspaceId: 'w',
    });
    const r = await client.commentOnIssue('iss1', 'hello world');

    expect(r.id).toBe('cmt1');
    // backend wants `content`; `body` returns 400 "content is required"
    expect(sent.content).toBe('hello world');
    expect(sent.body).toBeUndefined();
  });

  it('updateIssue PUTs snake_case fields (parent_issue_id / project_id)', async () => {
    const pool = mockAgent.get('http://multica.test');
    let method = '';
    let body: Record<string, unknown> = {};
    pool
      .intercept({ path: '/api/issues/iss1', method: 'PUT' })
      .reply(200, (opts: { method?: string; body?: string }) => {
        method = opts.method ?? '';
        body = JSON.parse(opts.body ?? '{}');
        return JSON.parse(issueFixture);
      });

    const client = new MulticaClient({
      serverUrl: 'http://multica.test',
      token: 't',
      workspaceId: 'w',
      labelMap: STANDARD_LABEL_MAP,
    });
    await client.updateIssue('iss1', {
      status: 'done',
      parentIssueId: 'plan1',
      projectId: 'proj1',
    });

    expect(method).toBe('PUT');
    expect(body).toEqual({ status: 'done', parent_issue_id: 'plan1', project_id: 'proj1' });
    expect(body.parentIssueId).toBeUndefined();
    expect(body.projectId).toBeUndefined();
  });
});
