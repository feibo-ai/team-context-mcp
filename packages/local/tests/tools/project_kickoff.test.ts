import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { projectKickoff } from '../../src/tools/project_kickoff.js';
import { MulticaClient } from '@tcmcp/shared';
import { STANDARD_LABEL_MAP, interceptAnyLabelAdd } from '@tcmcp/shared/test-helpers';

describe('project_kickoff', () => {
  let dir: string;
  let agent: MockAgent;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pk-'));
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await agent.close();
  });

  it('creates research + plan HTML + project + 2 issues; publishes the plan as a comment (research stub filled later)', async () => {
    const pool = agent.get('http://m.test');
    interceptAnyLabelAdd(pool);
    pool.intercept({ path: '/api/projects', method: 'POST' })
      .reply(201, { id: 'proj_k1', title: 'kickoff-test' });
    // Two createIssue calls now: research first, then plan. undici consumes
    // intercepts in registration order.
    pool.intercept({ path: '/api/issues', method: 'POST' })
      .reply(201, { id: 'research_k1', labels: ['研究'] });
    pool.intercept({ path: '/api/issues', method: 'POST' })
      .reply(201, { id: 'issue_k1', labels: ['计划-草稿'] });

    const client = new MulticaClient({
      serverUrl: 'http://m.test', token: 't', workspaceId: 'w',
    labelMap: STANDARD_LABEL_MAP });
    const publishDoc = vi.fn().mockResolvedValue({ attachmentId: 'att-x', commentId: 'cm-x', url: '/uploads/ws/att-x.html' });
    client.publishDoc = publishDoc;

    const r = await projectKickoff({
      projectPath: dir, slug: 'kickoff-test',
      dri: 'alice', topic: 'reduce p99 latency',
      goalDraft: 'cut p99 from 800ms to <400ms',
    }, { client });

    expect(r.researchPath).toMatch(/docs\/research\/research_\d{4}-\d{2}-\d{2}_kickoff-test\.html/);
    expect(r.planPath).toMatch(/docs\/plans\/plan_\d{4}-\d{2}-\d{2}_kickoff-test\.html/);
    expect(r.multicaProjectId).toBe('proj_k1');
    expect(r.multicaResearchIssueId).toBe('research_k1');
    expect(r.multicaIssueId).toBe('issue_k1');

    expect(r.broadcastSuggestion.tool).toBe('notify_team');
    expect(r.broadcastSuggestion.text.length).toBeGreaterThan(0);
    expect(r.broadcastSuggestion.text).toContain('kickoff-test');
    expect(r.broadcastSuggestion.text).toContain('alice');

    const research = await readFile(r.researchPath, 'utf-8');
    expect(research).toContain('<!DOCTYPE html>');
    expect(research).toContain('reduce p99 latency');

    const plan = await readFile(r.planPath, 'utf-8');
    expect(plan).toContain('<!DOCTYPE html>');
    // goalDraft contains '<', so esc() renders it as &lt;
    expect(plan).toContain('cut p99 from 800ms to &lt;400ms');

    // The plan doc is published as a COMMENT (append-only · !file inline). The
    // research issue is a STUB — nothing published now (the agent fills it and
    // publishes findings via doc_publish later). So exactly ONE publishDoc, to
    // the plan issue.
    expect(publishDoc).toHaveBeenCalledTimes(1);
    const [pIssueId, pOpts] = publishDoc.mock.calls[0];
    expect(pIssueId).toBe('issue_k1');
    expect(pOpts.html).toBe(plan);
    expect(pOpts.filename).toMatch(/^plan_\d{4}-\d{2}-\d{2}_kickoff-test_v1\.html$/);

    expect(r.researchAttachmentId).toBeNull();
    expect(r.planAttachmentId).toBe('att-x');
  });
});
