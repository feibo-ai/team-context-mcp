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
    publishDoc: vi.fn().mockResolvedValue({ attachmentId: 'att-2', commentId: 'c1', url: '/uploads/ws/att-2.html' }),
    commentOnIssue: vi.fn().mockResolvedValue({ id: 'c1' }),
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

  it('no planInput → label/status transition only (degraded), no upload/comment', async () => {
    const client = spyClient();

    const r = await planUpgrade(
      {
        planPath: join(dir, 'plan_x.html'),
        multicaIssueId: 'issue_p1',
        reason: 'realized X was wrong, need to redo Y',
      },
      { client },
    );

    // Degraded: no attachment, no HTML regeneration, no comment.
    expect(r.attachmentId).toBeNull();
    expect(client.publishDoc).not.toHaveBeenCalled();
    expect(client.commentOnIssue).not.toHaveBeenCalled();

    // State machine still runs: clears approved, marks upgraded + draft, → in_review.
    expect(client.removeLabel).toHaveBeenCalledWith('issue_p1', '计划-已批准');
    expect(client.addLabel).toHaveBeenCalledWith('issue_p1', '计划-已升级');
    expect(client.addLabel).toHaveBeenCalledWith('issue_p1', '计划-草稿');
    expect(client.updateIssue).toHaveBeenCalledWith('issue_p1', { status: 'in_review' });
  });

  it('planInput → regenerates HTML, uploads single-version attachment, overwrites local, comments', async () => {
    const planPath = join(dir, 'plan_x.html');
    await writeFile(planPath, '<!DOCTYPE html><html>old v1</html>');
    const client = spyClient();

    const r = await planUpgrade(
      {
        planPath,
        multicaIssueId: 'issue_p1',
        reason: 'realized X was wrong, need to redo Y',
        version: 2,
        planInput: {
          projectPath: dir,
          slug: 'feed-latency',
          layer: 'project',
          dri: 'alice',
          goal: 'Reduce p99 to <300ms',
          completionCriteria: ['p99 <300ms over 24h prod'],
          appetite: '1 week',
        },
      },
      { client },
    );

    // Single coherent version used everywhere (no disjoint 1.1-vs-2 scheme).
    expect(r.version).toBe(2);
    expect(r.attachmentId).toBe('att-2');

    // Local HTML file overwritten with freshly regenerated plan (escaped).
    const updated = await readFile(planPath, 'utf-8');
    expect(updated).toContain('<!DOCTYPE html>');
    expect(updated).toContain('Reduce p99 to &lt;300ms');
    expect(updated).not.toContain('old v1');

    // New versioned doc published as a COMMENT (append, never mutate) via
    // publishDoc: vN filename + the upgrade reason in the caption.
    const pubCall = (client.publishDoc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(pubCall[0]).toBe('issue_p1');
    expect(pubCall[1].filename).toBe('plan_v2.html');
    expect(pubCall[1].caption).toContain('v2');
    expect(pubCall[1].caption).toContain('realized X was wrong');

    // Success path: publishDoc owns the comment, so no separate text comment.
    expect(client.commentOnIssue).not.toHaveBeenCalled();

    // NO local markdown snapshot is created (versions live on the issue only).
    const files = await readdir(dir);
    expect(files.filter((f) => f.endsWith('.md'))).toHaveLength(0);

    // Existing label/status flow must still run.
    expect(client.removeLabel).toHaveBeenCalledWith('issue_p1', '计划-已批准');
    expect(client.addLabel).toHaveBeenCalledWith('issue_p1', '计划-已升级');
    expect(client.updateIssue).toHaveBeenCalledWith('issue_p1', { status: 'in_review' });

    // description is NEVER rewritten with the doc (append-only comment model).
    const descEmbed = (client.updateIssue as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[1]?.description?.includes('!file['));
    expect(descEmbed).toBeUndefined();
  });

  it('upload failure is non-fatal — labels/status land, comment notes the failure', async () => {
    const planPath = join(dir, 'plan_x.html');
    await writeFile(planPath, '<!DOCTYPE html><html>old</html>');
    const client = spyClient();
    (client.publishDoc as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const r = await planUpgrade(
      {
        planPath,
        multicaIssueId: 'issue_p1',
        reason: 'realized X was wrong, need to redo Y',
        version: 3,
        planInput: {
          projectPath: dir,
          slug: 'feed-latency',
          layer: 'project',
          goal: 'Reduce p99 to <300ms',
          completionCriteria: ['p99 <300ms'],
        },
      },
      { client },
    );

    expect(r.attachmentId).toBeNull();
    expect(r.uploadError).toMatch(/ECONNREFUSED/);
    // local HTML still overwritten despite upload failure
    expect(await readFile(planPath, 'utf-8')).toContain('<!DOCTYPE html>');
    // label/status transition still landed
    expect(client.updateIssue).toHaveBeenCalledWith('issue_p1', { status: 'in_review' });
    // comment still posted, flagging the upload failure
    const note = (client.commentOnIssue as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(note).toMatch(/发布失败/);
  });

  it('planInput 形状不全(缺 goal)→ 抛明确校验错,而不是渲染深处崩在 reading "replace"', async () => {
    const client = spyClient();
    // 旧版:planInput=z.any() 放行 → renderPlanHtml 里 esc(input.goal=undefined)
    // → "Cannot read properties of undefined (reading 'replace')"(晦涩)。
    // 现在 planInput 受 planCreateInput 校验,缺 goal 直接 zod 报错。
    await expect(planUpgrade(
      {
        planPath: join(dir, 'plan_x.html'),
        multicaIssueId: 'issue_p1',
        reason: 'realized X was wrong, need to redo Y',
        version: 2,
        // deliberately missing `goal`
        planInput: { projectPath: dir, slug: 'x', layer: 'project', completionCriteria: ['c'] } as never,
      },
      { client },
    )).rejects.toThrow(/goal/i);
  });
});
