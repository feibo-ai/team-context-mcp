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
    uploadFile: vi.fn().mockResolvedValue({ id: 'att-1', url: '/uploads/ws/att-1.html' }),
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

    expect(r.casePath).toMatch(/cases\/\d{4}-\d{2}-\d{2}-feed-latency\.html$/);
    expect(r.multicaIssueId).toBe('c1');
    expect(r.attachmentId).toBe('att-1');
    expect(client.createIssue).toHaveBeenCalled();
    expect(client.uploadFile).toHaveBeenCalled();
    const content = await readFile(r.casePath, 'utf-8');
    expect(content).toContain('<h2>1 · 目标</h2>');
    expect(content).toContain('<h2>2 · 实际发生</h2>');
    expect(content).toContain('<h2>3 · 完成标准</h2>');
    expect(content).toContain('<h2>4 · 关键判断</h2>');
    expect(content).toContain('<h2>5 · 规则候选</h2>');
    // goal contains "<400ms" — esc() turns < into &lt; in the HTML output.
    expect(content).toContain('Reduce p99 to &lt;400ms');
    // No planIssueId provided → no parent link set (no updateIssue carries parentIssueId).
    expect((client.updateIssue as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[1]?.parentIssueId)).toBeUndefined();
    // But the doc IS embedded into the description (!file token) + bound via
    // attachmentIds after a successful upload (with url), so it renders inline.
    const embedArg = (client.updateIssue as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[1]?.description?.includes('!file['))?.[1];
    expect(embedArg).toBeDefined();
    expect(embedArg.description).toContain('!file[');
    expect(embedArg.attachmentIds).toContain('att-1');
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
