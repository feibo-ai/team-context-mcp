import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { codeReviewRequest } from '../../src/tools/code_review_request.js';
import { MulticaClient } from '@tcmcp/shared';
import { STANDARD_LABEL_MAP, interceptAnyLabelAdd } from '@tcmcp/shared/test-helpers';

describe('code_review_request', () => {
  let agent: MockAgent;

  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
  });

  afterEach(async () => { await agent.close(); });

  it('refuses self-review (reviewer == implementer)', async () => {
    const client = new MulticaClient({ serverUrl: 'http://m.test', token: 't', workspaceId: 'w', labelMap: STANDARD_LABEL_MAP });
    await expect(codeReviewRequest({
      implementerAgentId: 'agent-A',
      reviewerAgentId: 'agent-A',
      commitHash: 'abc1234',
      prUrl: 'https://github.com/x/repo/pull/1',
      context: 'Plan 2 plan_approve impl',
    }, { client })).rejects.toThrow(/self-review/i);
  });

  it('creates issue assigned to reviewer with label code-review', async () => {
    const pool = agent.get('http://m.test');
    interceptAnyLabelAdd(pool);
    pool.intercept({ path: '/api/issues', method: 'POST' }).reply(201, {
      id: 'cr_1', title: 'Code Review: abc1234', labels: ['code-review'],
    });

    const client = new MulticaClient({ serverUrl: 'http://m.test', token: 't', workspaceId: 'w', labelMap: STANDARD_LABEL_MAP });
    const r = await codeReviewRequest({
      implementerAgentId: 'agent-A',
      reviewerAgentId: 'agent-B',
      commitHash: 'abc1234',
      prUrl: 'https://github.com/x/repo/pull/1',
      context: 'Plan 2 plan_approve impl',
    }, { client });

    expect(r.reviewIssueId).toBe('cr_1');
  });
});
