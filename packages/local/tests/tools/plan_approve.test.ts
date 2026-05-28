import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { planApprove } from '../../src/tools/plan_approve.js';
import { MulticaClient } from '@tcmcp/shared';
import { STANDARD_LABEL_MAP, interceptAnyLabelAdd } from '@tcmcp/shared/test-helpers';

describe('plan_approve', () => {
  let agent: MockAgent;
  let dir: string;

  beforeEach(async () => {
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    dir = await mkdtemp(join(tmpdir(), 'pa-'));
  });

  afterEach(async () => {
    await agent.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('adds approved label and updates plan Review section', async () => {
    const pool = agent.get('http://m.test');
    interceptAnyLabelAdd(pool);
    pool
      .intercept({ path: '/api/issues/issue_p1/labels', method: 'POST' })
      .reply(201, {});

    const planPath = join(dir, 'plan.md');
    await writeFile(
      planPath,
      [
        '# Plan: x',
        '',
        '## Goal',
        'do thing',
        '',
        '## Review',
        '- Reviewer: _(pending)_',
        '- Reviewed: _(pending)_',
        '- Verdict: pending',
        '',
      ].join('\n')
    );

    const client = new MulticaClient({
      serverUrl: 'http://m.test',
      token: 't',
      workspaceId: 'w',
    labelMap: STANDARD_LABEL_MAP });

    await planApprove(
      {
        multicaIssueId: 'issue_p1',
        planPath,
        reviewer: 'bob',
      },
      { client }
    );

    const updated = await readFile(planPath, 'utf-8');
    expect(updated).toMatch(/Reviewer:\s*bob/);
    expect(updated).toMatch(/Verdict:\s*approved/);
  });
});
