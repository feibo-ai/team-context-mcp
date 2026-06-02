import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { docPublish } from '../../src/tools/doc_publish.js';
import type { MulticaClient } from '@tcmcp/shared';

describe('doc_publish', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dp-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the local doc and publishes it as a COMMENT via publishDoc', async () => {
    const publishDoc = vi
      .fn()
      .mockResolvedValue({ attachmentId: 'att-r', commentId: 'cm-r', url: '/uploads/ws/att-r.html' });
    const client = { publishDoc } as unknown as MulticaClient;
    const docPath = join(dir, 'research_2026-06-01_snake-game.html');
    await writeFile(docPath, '<!DOCTYPE html><html><body>findings</body></html>', 'utf-8');

    const r = await docPublish(
      { multicaIssueId: 'r_1', docPath, caption: '研究文档(方案A · 下方渲染)' },
      { client },
    );

    // Reads the filled local HTML and hands it to publishDoc (which uploads +
    // comments + binds) — the agent never touches an attachment or the desc.
    expect(publishDoc).toHaveBeenCalledTimes(1);
    const [issueId, opts] = publishDoc.mock.calls[0];
    expect(issueId).toBe('r_1');
    expect(opts.html).toContain('findings');
    expect(opts.filename).toBe('research_2026-06-01_snake-game.html');
    expect(opts.caption).toBe('研究文档(方案A · 下方渲染)');
    expect(r.attachmentId).toBe('att-r');
    expect(r.commentId).toBe('cm-r');
    expect(r.filename).toBe('research_2026-06-01_snake-game.html');
  });

  it('defaults the caption when none is given', async () => {
    const publishDoc = vi.fn().mockResolvedValue({ attachmentId: 'a', commentId: 'c' });
    const client = { publishDoc } as unknown as MulticaClient;
    const docPath = join(dir, 'doc.html');
    await writeFile(docPath, '<html></html>', 'utf-8');

    await docPublish({ multicaIssueId: 'i', docPath }, { client });
    expect(publishDoc.mock.calls[0][1].caption).toContain('文档');
  });
});
