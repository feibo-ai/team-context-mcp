import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { MulticaClient } from '../../src/lib/multica.js';

const here = dirname(fileURLToPath(import.meta.url));
const issueFixture = readFileSync(
  resolve(here, '../fixtures/multica-issue-create.json'),
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
    mockAgent
      .get('http://multica.test')
      .intercept({ path: '/api/issues', method: 'POST' })
      .reply(201, JSON.parse(issueFixture));

    const client = new MulticaClient({
      serverUrl: 'http://multica.test',
      token: 'mul_test',
      workspaceId: 'ws_test',
    });

    const issue = await client.createIssue({
      title: 'Plan: feed latency',
      labels: ['plan-draft'],
      projectId: 'proj_xyz',
    });

    expect(issue.id).toBe('issue_abc123');
    expect(issue.labels).toContain('plan-draft');
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
});
