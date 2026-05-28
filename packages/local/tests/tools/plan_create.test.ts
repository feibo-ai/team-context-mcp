import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { planCreate } from '../../src/tools/plan_create.js';
import { MulticaClient } from '@tcmcp/shared';
import { STANDARD_LABEL_MAP, interceptAnyLabelAdd } from '@tcmcp/shared/test-helpers';

describe('plan_create', () => {
  let dir: string;
  let agent: MockAgent;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'plan-'));
    const g = simpleGit(dir);
    await g.init(['-b', 'main']);
    await g.addConfig('user.email', 'test@x');
    await g.addConfig('user.name', 'Test');

    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    const pool = agent.get('http://m.test');
    pool.intercept({ path: '/api/issues', method: 'POST' }).reply(201, {
      id: 'issue_p1',
      title: 'Plan: feed-latency',
      status: 'open',
      labels: ['plan-draft'],
    });
    interceptAnyLabelAdd(pool);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await agent.close();
  });

  it('writes plan file and creates multica issue', async () => {
    const client = new MulticaClient({
      serverUrl: 'http://m.test',
      token: 't',
      workspaceId: 'w',
    labelMap: STANDARD_LABEL_MAP });
    const result = await planCreate(
      {
        projectPath: dir,
        slug: 'feed-latency',
        layer: 'project',
        dri: 'alice',
        goal: 'Reduce p99 to <400ms',
        completionCriteria: ['p99 <400ms over 24h prod'],
        appetite: '1 week',
      },
      { client }
    );

    expect(result.planPath).toMatch(/docs\/plans\/plan_\d{4}-\d{2}-\d{2}_feed-latency\.md/);
    expect(result.multicaIssueId).toBe('issue_p1');

    const content = await readFile(result.planPath, 'utf-8');
    expect(content).toContain('## Goal\nReduce p99 to <400ms');
    expect(content).toContain('p99 <400ms over 24h prod');
    expect(content).toContain('**DRI:** alice');
  });
});
