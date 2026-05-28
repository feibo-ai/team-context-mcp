import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { planRequestReview } from '../../src/tools/plan_request_review.js';
import { MulticaClient } from '../../src/lib/multica.js';
import { STANDARD_LABEL_MAP, interceptAnyLabelAdd } from '../helpers/multica-mock.js';

describe('plan_request_review', () => {
  let agent: MockAgent;

  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
  });

  afterEach(async () => {
    await agent.close();
  });

  it('adds under-review label and posts review prompt', async () => {
    const pool = agent.get('http://m.test');
    interceptAnyLabelAdd(pool);
    pool
      .intercept({ path: '/api/issues/issue_p1/labels', method: 'POST' })
      .reply(201, {});
    pool
      .intercept({ path: '/api/issues/issue_p1/comments', method: 'POST' })
      .reply(201, { id: 'cm_1' });

    const client = new MulticaClient({
      serverUrl: 'http://m.test',
      token: 't',
      workspaceId: 'w',
    labelMap: STANDARD_LABEL_MAP });

    const r = await planRequestReview(
      { multicaIssueId: 'issue_p1', reviewer: 'bob' },
      { client }
    );
    expect(r.commentId).toBe('cm_1');
  });
});
