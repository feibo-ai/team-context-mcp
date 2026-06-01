import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { caseCreate } from '../../src/tools/case_create.js';
import type { MulticaClient } from '@tcmcp/shared';

function spyClient() {
  return {
    createIssue: vi.fn(async () => ({ id: 'c1' })),
    updateIssue: vi.fn(async () => ({})),
  } as unknown as MulticaClient;
}

const baseJudgment = {
  title: 'Cache key strategy',
  context: 'old key triggered storms',
  options: ['A', 'B'],
  chose: 'A — fewer collisions',
  inHindsight: 'right call',
  ancientImpossible: 'No, would have done same pre-AI',
};

describe('case_create', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'case-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes case file with all 5 sections + creates the 复盘 issue', async () => {
    const client = spyClient();
    const r = await caseCreate(
      {
        projectPath: dir,
        slug: 'feed-latency',
        goal: 'Reduce p99 to <400ms',
        whatHappened: 'Tried cache tuning. Worked.',
        criteriaResults: [{ criterion: 'p99 <400ms 24h', met: true }],
        keyJudgments: [baseJudgment],
        ruleCandidates: ['Always check cache key collision in load test'],
      },
      { client },
    );

    expect(r.casePath).toMatch(/cases\/\d{4}-\d{2}-\d{2}-feed-latency\.md/);
    expect(r.multicaIssueId).toBe('c1');
    expect(client.createIssue).toHaveBeenCalled();
    const content = await readFile(r.casePath, 'utf-8');
    expect(content).toContain('## 1. 目标');
    expect(content).toContain('## 2. 实际发生了什么');
    expect(content).toContain('## 3. 完成标准');
    expect(content).toContain('## 4. 关键判断');
    expect(content).toContain('## 5. 通用规则候选');
    // No planIssueId provided → no parent link set.
    expect(client.updateIssue).not.toHaveBeenCalled();
  });

  it('links case → plan via parent_issue_id when planIssueId given', async () => {
    const client = spyClient();
    await caseCreate(
      {
        projectPath: dir,
        slug: 'linked',
        goal: 'g',
        whatHappened: 'w',
        criteriaResults: [{ criterion: 'c', met: true }],
        keyJudgments: [baseJudgment],
        ruleCandidates: [],
        planIssueId: 'plan_99',
      },
      { client },
    );
    expect(client.updateIssue).toHaveBeenCalledWith('c1', { parentIssueId: 'plan_99' });
  });

  it('refuses to overwrite an existing case file', async () => {
    const client = spyClient();
    const args = {
      projectPath: dir,
      slug: 'feed-latency',
      goal: 'g',
      whatHappened: 'first run',
      criteriaResults: [{ criterion: 'c', met: true }],
      keyJudgments: [baseJudgment],
      ruleCandidates: [] as string[],
    };

    const first = await caseCreate(args, { client });
    expect(await readFile(first.casePath, 'utf-8')).toContain('first run');

    await expect(
      caseCreate({ ...args, whatHappened: 'second run — should NOT overwrite' }, { client }),
    ).rejects.toThrow(/already exists/);

    const after = await readFile(first.casePath, 'utf-8');
    expect(after).toContain('first run');
    expect(after).not.toContain('second run');
  });
});
