import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { caseCreate } from '../../src/tools/case_create.js';
import { MulticaClient } from '../../src/lib/multica.js';

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
    agent
      .get('http://m.test')
      .intercept({ path: '/api/issues', method: 'POST' })
      .reply(201, { id: 'c1', title: 'Debrief', status: 'open', labels: ['debrief'] });

    const client = new MulticaClient({
      serverUrl: 'http://m.test',
      token: 't',
      workspaceId: 'w',
    });

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
});
