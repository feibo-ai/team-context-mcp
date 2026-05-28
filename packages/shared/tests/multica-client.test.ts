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
