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

  it('creates research + plan HTML + multica project + 2 issues + uploads both attachments', async () => {
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
    const uploadFile = vi.fn().mockResolvedValue({ id: 'att-x', url: '/uploads/ws/att-x.html' });
    client.uploadFile = uploadFile;
    const updateIssue = vi.fn().mockResolvedValue({});
    client.updateIssue = updateIssue;

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

    // Two uploads: research issue + plan issue.
    expect(uploadFile).toHaveBeenCalledTimes(2);
    const [rContent, rName, rIssueId, rType] = uploadFile.mock.calls[0];
    expect(rContent).toBe(research);
    expect(rName).toMatch(/^research_\d{4}-\d{2}-\d{2}_kickoff-test_v1\.html$/);
    expect(rIssueId).toBe('research_k1');
    expect(rType).toBe('text/html');
    const [pContent, pName, pIssueId, pType] = uploadFile.mock.calls[1];
    expect(pContent).toBe(plan);
    expect(pName).toMatch(/^plan_\d{4}-\d{2}-\d{2}_kickoff-test_v1\.html$/);
    expect(pIssueId).toBe('issue_k1');
    expect(pType).toBe('text/html');

    expect(r.researchAttachmentId).toBe('att-x');
    expect(r.planAttachmentId).toBe('att-x');

    // Both docs embedded into their issue's description (!file token) + bound via
    // attachmentIds after a successful upload (with url), so each renders inline.
    const researchEmbed = updateIssue.mock.calls.find((c) => c[0] === 'research_k1' && c[1]?.description?.includes('!file['))?.[1];
    expect(researchEmbed).toBeDefined();
    expect(researchEmbed.description).toContain('!file[');
    expect(researchEmbed.attachmentIds).toContain('att-x');
    const planEmbed = updateIssue.mock.calls.find((c) => c[0] === 'issue_k1' && c[1]?.description?.includes('!file['))?.[1];
    expect(planEmbed).toBeDefined();
    expect(planEmbed.description).toContain('!file[');
    expect(planEmbed.attachmentIds).toContain('att-x');
  });
});
