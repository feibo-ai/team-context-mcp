import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { caseReview } from '../../src/tools/case_review.js';
import type { MulticaClient } from '@tcmcp/shared';

const SUBSTANTIVE = `### 判断: cache strategy
- **背景:** old cache key triggered storms during peak load
- **选项:** A) hash userID B) hash userID+region
- **选择:** A — fewer collisions in our 测试
- **事后看:** correct, p99 dropped 600ms→340ms
- **"古法不可能"检验:** No, would have done same pre-AI
`;
const TRIVIAL = `### 判断: x\n- short\n`;

// getIssue returns the case issue; parent_issue_id models the case→plan link
// set by case_create. addLabel/removeLabel/updateIssue HTTP is covered in
// multica-client.test.ts.
function spyClient(parentIssueId: string | null) {
  return {
    addLabel: vi.fn(async () => {}),
    removeLabel: vi.fn(async () => {}),
    updateIssue: vi.fn(async () => ({})),
    getIssue: vi.fn(async () => ({ id: 'i1', parent_issue_id: parentIssueId })),
  } as unknown as MulticaClient;
}

describe('case_review', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cr-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('refuses if section 4 is trivially short (no labels/status touched)', async () => {
    const casePath = join(dir, 'case.md');
    await writeFile(casePath, `# Case\n\n## 4. 关键判断\n${TRIVIAL}\n\n## 5. 通用规则候选\n`);
    const client = spyClient(null);
    await expect(
      caseReview({ casePath, multicaIssueId: 'i1', reviewerEmail: 'a@b' }, { client }),
    ).rejects.toThrow(/section 4.*too short/i);
    expect(client.addLabel).not.toHaveBeenCalled();
    expect(client.updateIssue).not.toHaveBeenCalled();
  });

  it('reviewed: +复盘-已审 −复盘-待审, status done, auto-closes the linked plan issue', async () => {
    const casePath = join(dir, 'case.md');
    await writeFile(casePath, `# Case\n\n## 4. 关键判断\n${SUBSTANTIVE}\n\n## 5. 通用规则候选\n`);
    const client = spyClient('plan_x');

    const r = await caseReview(
      { casePath, multicaIssueId: 'i1', reviewerEmail: 'dri@aimiq' },
      { client },
    );

    expect(r.reviewed).toBe(true);
    expect(r.closedPlanIssueId).toBe('plan_x');
    expect(client.addLabel).toHaveBeenCalledWith('i1', '复盘-已审');
    expect(client.removeLabel).toHaveBeenCalledWith('i1', '复盘-待审');
    expect(client.updateIssue).toHaveBeenCalledWith('i1', { status: 'done' });
    // §6 auto-close: parent plan issue (found via parent_issue_id) also done.
    expect(client.updateIssue).toHaveBeenCalledWith('plan_x', { status: 'done' });

    const updated = await readFile(casePath, 'utf-8');
    expect(updated).toMatch(/Reviewed by:\s*dri@aimiq/);
  });

  it('no parent link → only the case issue is closed', async () => {
    const casePath = join(dir, 'case.md');
    await writeFile(casePath, `# Case\n\n## 4. 关键判断\n${SUBSTANTIVE}\n\n## 5. 通用规则候选\n`);
    const client = spyClient(null);

    const r = await caseReview(
      { casePath, multicaIssueId: 'i1', reviewerEmail: 'dri@aimiq' },
      { client },
    );

    expect(r.closedPlanIssueId).toBeUndefined();
    expect(client.updateIssue).toHaveBeenCalledTimes(1);
    expect(client.updateIssue).toHaveBeenCalledWith('i1', { status: 'done' });
  });
});
