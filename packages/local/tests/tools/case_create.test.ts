import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { caseCreate } from '../../src/tools/case_create.js';
import { MulticaClient } from '@tcmcp/shared';
import { STANDARD_LABEL_MAP, interceptAnyLabelAdd } from '@tcmcp/shared/test-helpers';

describe('case_create', () => {
  let dir: string;
  let agent: MockAgent;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'case-'));
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await agent.close();
  });

  it('writes case file with all 5 sections', async () => {
    const pool = agent.get('http://m.test');
    pool.intercept({ path: '/api/issues', method: 'POST' })
      .reply(201, { id: 'c1', title: 'Debrief', status: 'open', labels: ['debrief'] });
    interceptAnyLabelAdd(pool);

    const client = new MulticaClient({
      serverUrl: 'http://m.test',
      token: 't',
      workspaceId: 'w',
    labelMap: STANDARD_LABEL_MAP });

    const r = await caseCreate(
      {
        projectPath: dir,
        slug: 'feed-latency',
        goal: 'Reduce p99 to <400ms',
        whatHappened: 'Tried cache tuning. Worked.',
        criteriaResults: [{ criterion: 'p99 <400ms 24h', met: true }],
        keyJudgments: [
          {
            title: 'Cache key strategy',
            context: 'old key triggered storms',
            options: ['A', 'B'],
            chose: 'A — fewer collisions',
            inHindsight: 'right call',
            ancientImpossible: 'No, would have done same pre-AI',
          },
        ],
        ruleCandidates: ['Always check cache key collision in load test'],
      },
      { client }
    );

    expect(r.casePath).toMatch(/cases\/\d{4}-\d{2}-\d{2}-feed-latency\.md/);
    const content = await readFile(r.casePath, 'utf-8');
    expect(content).toContain('## 1. Goal');
    expect(content).toContain('## 2. What actually happened');
    expect(content).toContain('## 3. Completion criteria');
    expect(content).toContain('## 4. Key judgments');
    expect(content).toContain('## 5. General rule candidates');
  });

  it('refuses to overwrite an existing case file', async () => {
    const pool = agent.get('http://m.test');
    pool.intercept({ path: '/api/issues', method: 'POST' })
      .reply(201, { id: 'c1', title: 'Debrief', status: 'open', labels: ['debrief'] })
      .persist(); // allow first call's createIssue; second call shouldn't reach this
    interceptAnyLabelAdd(pool);

    const client = new MulticaClient({
      serverUrl: 'http://m.test',
      token: 't',
      workspaceId: 'w',
    labelMap: STANDARD_LABEL_MAP });

    const args = {
      projectPath: dir,
      slug: 'feed-latency',
      goal: 'Reduce p99 to <400ms',
      whatHappened: 'first run',
      criteriaResults: [{ criterion: 'p99 <400ms 24h', met: true }],
      keyJudgments: [{
        title: 'Cache key',
        context: 'collisions',
        options: ['A', 'B'],
        chose: 'A',
        inHindsight: 'right call',
        ancientImpossible: 'No',
      }],
      ruleCandidates: [],
    };

    // First call writes the case file.
    const first = await caseCreate(args, { client });
    const firstContent = await readFile(first.casePath, 'utf-8');
    expect(firstContent).toContain('first run');

    // Second call with identical slug + same day → should throw, not silently overwrite.
    await expect(
      caseCreate({ ...args, whatHappened: 'second run — should NOT overwrite' }, { client })
    ).rejects.toThrow(/already exists/);

    // File on disk must still be the first version (no silent overwrite).
    const after = await readFile(first.casePath, 'utf-8');
    expect(after).toContain('first run');
    expect(after).not.toContain('second run');
  });
});
