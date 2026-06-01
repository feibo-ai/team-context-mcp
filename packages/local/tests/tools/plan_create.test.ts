import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { planCreate } from '../../src/tools/plan_create.js';
import type { MulticaClient } from '@tcmcp/shared';

describe('plan_create', () => {
  let dir: string;
  let createIssue: ReturnType<typeof vi.fn>;
  let uploadFile: ReturnType<typeof vi.fn>;
  let client: MulticaClient;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'plan-'));
    const g = simpleGit(dir);
    await g.init(['-b', 'main']);
    await g.addConfig('user.email', 'test@x');
    await g.addConfig('user.name', 'Test');

    createIssue = vi.fn().mockResolvedValue({
      id: 'issue_p1',
      title: 'Plan: feed-latency',
      status: 'open',
      labels: ['plan-draft'],
    });
    uploadFile = vi.fn().mockResolvedValue({ id: 'att-1' });
    client = { createIssue, uploadFile } as unknown as MulticaClient;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes plan file and creates multica issue', async () => {
    const result = await planCreate(
      {
        projectPath: dir,
        slug: 'feed-latency',
        layer: 'project',
        dri: 'alice',
        goal: 'Reduce p99 to <400ms',
        completionCriteria: ['p99 <400ms over 24h prod'],
        appetite: '1 week',
      },
      { client }
    );

    expect(result.planPath).toMatch(/docs\/plans\/plan_\d{4}-\d{2}-\d{2}_.*\.html$/);
    expect(result.multicaIssueId).toBe('issue_p1');
    expect(createIssue).toHaveBeenCalled();
    expect(createIssue.mock.calls[0][0].labels).toContain('计划-草稿');

    const content = await readFile(result.planPath, 'utf-8');
    expect(content).toContain('<!DOCTYPE html>');
    // renderPlanHtml HTML-escapes content, so `<` becomes `&lt;`
    expect(content).toContain('Reduce p99 to &lt;400ms');
    expect(content).toContain('p99 &lt;400ms over 24h prod');
    expect(content).toContain('alice');

    expect(uploadFile).toHaveBeenCalled();
    expect(result.attachmentId).toBe('att-1');
  });

  it('is idempotent — second call reuses existing plan file', async () => {
    const args = {
      projectPath: dir,
      slug: 'feed-latency',
      layer: 'project' as const,
      dri: 'alice',
      goal: 'Reduce p99 to <400ms',
      completionCriteria: ['p99 <400ms over 24h prod'],
      appetite: '1 week',
    };
    const first = await planCreate(args, { client });
    expect(first.alreadyExisted).toBe(false);

    const second = await planCreate(args, { client });
    expect(second.alreadyExisted).toBe(true);
    expect(second.planPath).toBe(first.planPath);
  });
});
