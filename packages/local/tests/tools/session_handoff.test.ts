import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { sessionHandoff } from '../../src/tools/session_handoff.js';
import type { MulticaClient } from '@tcmcp/shared';

describe('session_handoff', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sh-'));
    const g = simpleGit(dir);
    await g.init(['-b', 'main']);
    await g.addConfig('user.email', 'a@b');
    await g.addConfig('user.name', 'Test');
    await writeFile(join(dir, 'README.md'), 'r');
    await g.add('-A');
    await g.commit('initial');

    await mkdir(join(dir, 'docs', 'plans'), { recursive: true });
    await writeFile(
      join(dir, 'docs', 'plans', 'plan_2026-05-26_x.md'),
      [
        '# Plan: x',
        '',
        '## Goal',
        'do x',
        '',
      ].join('\n')
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('commits WIP and writes Current State section', async () => {
    await writeFile(join(dir, 'changed.txt'), 'wip');

    const r = await sessionHandoff(
      {
        projectPath: dir,
        currentState: 'wrote foo()',
        nextAction: 'wire bar() into baz.ts',
        pollutionSignal: 'You-are-right loop',
        deadEnds: ['tried mock-X — broke type checker'],
        wipStrategy: 'commit',
        wipMessage: 'mid-refactor',
      },
      {}
    );

    expect(r.commitHash).toMatch(/^[a-f0-9]{7,}$/);
    expect(r.planPath).toContain('plan_2026-05-26_x.md');

    const updated = await readFile(r.planPath, 'utf-8');
    expect(updated).toContain('## 当前状态');
    expect(updated).toContain('wrote foo()');
    expect(updated).toContain('wire bar() into baz.ts');
    expect(updated).toContain('tried mock-X');
    expect(updated).toContain('You-are-right loop');
  });

  it('backward compat — no planInput → posts comment, never uploads', async () => {
    const commentOnIssue = vi.fn().mockResolvedValue({ id: 'cmt-1' });
    const uploadFile = vi.fn().mockResolvedValue({ id: 'att-h' });
    const client = { commentOnIssue, uploadFile } as unknown as MulticaClient;

    const r = await sessionHandoff(
      {
        projectPath: dir,
        currentState: 'wrote foo()',
        nextAction: 'wire bar()',
        pollutionSignal: 'You-are-right loop',
        multicaIssueId: 'issue_h1',
      },
      { client }
    );

    expect(commentOnIssue).toHaveBeenCalledTimes(1);
    expect(commentOnIssue.mock.calls[0][0]).toBe('issue_h1');
    expect(r.multicaCommentId).toBe('cmt-1');
    // no planInput → must NOT upload any attachment
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('regenerates HTML attachment when planInput + multicaIssueId provided', async () => {
    const commentOnIssue = vi.fn().mockResolvedValue({ id: 'cmt-1' });
    const uploadFile = vi.fn().mockResolvedValue({ id: 'att-h' });
    const client = { commentOnIssue, uploadFile } as unknown as MulticaClient;

    const planHtmlPath = join(dir, 'docs', 'plans', 'plan_2026-05-26_x.html');
    await writeFile(planHtmlPath, '<!DOCTYPE html><html>old</html>', 'utf-8');

    const r = await sessionHandoff(
      {
        projectPath: dir,
        planPath: planHtmlPath,
        currentState: 'wrote foo()',
        nextAction: 'wire bar()',
        pollutionSignal: 'You-are-right loop',
        multicaIssueId: 'issue_h1',
        planInput: {
          projectPath: dir,
          slug: 'x',
          layer: 'project',
          dri: 'alice',
          goal: 'Reduce p99 to <400ms',
          completionCriteria: ['p99 <400ms over 24h'],
          appetite: '1 week',
        },
      },
      { client }
    );

    // existing comment behavior unchanged
    expect(commentOnIssue).toHaveBeenCalledTimes(1);
    expect(r.multicaCommentId).toBe('cmt-1');

    // new: HTML attachment uploaded with text/html + the issueId
    expect(uploadFile).toHaveBeenCalledTimes(1);
    const [content, filename, issueId, contentType] = uploadFile.mock.calls[0];
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('Reduce p99 to &lt;400ms');
    expect(filename).toMatch(/^plan_handoff_\d+\.html$/);
    expect(issueId).toBe('issue_h1');
    expect(contentType).toBe('text/html');

    // local .html overwritten with regenerated plan
    const onDisk = await readFile(planHtmlPath, 'utf-8');
    expect(onDisk).toContain('Reduce p99 to &lt;400ms');
    expect(onDisk).not.toContain('>old<');
  });
});
