import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planUpgrade } from '../../src/tools/plan_upgrade.js';
import type { MulticaClient } from '@tcmcp/shared';

function spyClient() {
  return {
    addLabel: vi.fn(async () => {}),
    removeLabel: vi.fn(async () => {}),
    updateIssue: vi.fn(async () => ({})),
  } as unknown as MulticaClient;
}

describe('plan_upgrade', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pu-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('bumps version + snapshots, clears 计划-已批准, adds 计划-已升级/计划-草稿, status in_review', async () => {
    const planPath = join(dir, 'plan_x.md');
    await writeFile(
      planPath,
      ['---', 'version: 1.0', '---', '# Plan: x', '', '## Goal', 'do x'].join('\n'),
    );
    const client = spyClient();

    const r = await planUpgrade(
      { planPath, multicaIssueId: 'issue_p1', reason: 'realized X was wrong, need to redo Y' },
      { client },
    );

    expect(r.newVersion).toBe('1.1');
    expect(r.snapshotPath).toMatch(/plan_x_v1\.0\.md$/);

    const updated = await readFile(planPath, 'utf-8');
    expect(updated).toMatch(/version: 1\.1/);
    expect(updated).toContain('## 升级日志');
    expect(updated).toContain('1.0 → 1.1');
    expect(updated).toContain('realized X was wrong');
    expect(await readdir(dir)).toContain('plan_x_v1.0.md');

    // State machine: upgrade clears approved, marks upgraded + draft, → in_review.
    expect(client.removeLabel).toHaveBeenCalledWith('issue_p1', '计划-已批准');
    expect(client.addLabel).toHaveBeenCalledWith('issue_p1', '计划-已升级');
    expect(client.addLabel).toHaveBeenCalledWith('issue_p1', '计划-草稿');
    expect(client.updateIssue).toHaveBeenCalledWith('issue_p1', { status: 'in_review' });
  });
});
