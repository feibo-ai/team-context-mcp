import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planApprove } from '../../src/tools/plan_approve.js';
import type { MulticaClient } from '@tcmcp/shared';

// Spy client — the HTTP round-trip for addLabel/removeLabel/updateIssue is
// covered by multica-client.test.ts; here we assert the state-machine
// orchestration (which labels move, which status is set).
function spyClient() {
  return {
    addLabel: vi.fn(async () => {}),
    removeLabel: vi.fn(async () => {}),
    updateIssue: vi.fn(async () => ({})),
  } as unknown as MulticaClient;
}

describe('plan_approve', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pa-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('+计划-已批准, −计划-草稿/−计划-评审中, status in_progress, writes 评审 section', async () => {
    const planPath = join(dir, 'plan.md');
    await writeFile(
      planPath,
      [
        '# Plan: x',
        '',
        '## 目标',
        'do thing',
        '',
        '## 评审',
        '- Reviewer: _(pending)_',
        '- Reviewed: _(pending)_',
        '- Verdict: pending',
        '',
      ].join('\n'),
    );
    const client = spyClient();

    await planApprove({ multicaIssueId: 'issue_p1', planPath, reviewer: 'bob' }, { client });

    // Label state machine + status linkage.
    expect(client.addLabel).toHaveBeenCalledWith('issue_p1', '计划-已批准');
    expect(client.removeLabel).toHaveBeenCalledWith('issue_p1', '计划-草稿');
    expect(client.removeLabel).toHaveBeenCalledWith('issue_p1', '计划-评审中');
    expect(client.updateIssue).toHaveBeenCalledWith('issue_p1', { status: 'in_progress' });

    // Markdown Review section still updated.
    const updated = await readFile(planPath, 'utf-8');
    expect(updated).toMatch(/Reviewer:\s*bob/);
    expect(updated).toMatch(/Verdict:\s*approved/);
  });
});
