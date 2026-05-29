import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

  it('creates research + plan skeletons + multica project + initial issue', async () => {
    const pool = agent.get('http://m.test');
    interceptAnyLabelAdd(pool);
    pool.intercept({ path: '/api/projects', method: 'POST' })
      .reply(201, { id: 'proj_k1', title: 'kickoff-test' });
    pool.intercept({ path: '/api/issues', method: 'POST' })
      .reply(201, { id: 'issue_k1', labels: ['plan-draft'] });

    const client = new MulticaClient({
      serverUrl: 'http://m.test', token: 't', workspaceId: 'w',
    labelMap: STANDARD_LABEL_MAP });

    const r = await projectKickoff({
      projectPath: dir, slug: 'kickoff-test',
      dri: 'alice', topic: 'reduce p99 latency',
      goalDraft: 'cut p99 from 800ms to <400ms',
    }, { client });

    expect(r.researchPath).toMatch(/docs\/research\/research_\d{4}-\d{2}-\d{2}_kickoff-test\.md/);
    expect(r.planPath).toMatch(/docs\/plans\/plan_\d{4}-\d{2}-\d{2}_kickoff-test\.md/);
    expect(r.multicaProjectId).toBe('proj_k1');
    expect(r.multicaIssueId).toBe('issue_k1');

    expect(r.broadcastSuggestion.tool).toBe('notify_team');
    expect(r.broadcastSuggestion.text.length).toBeGreaterThan(0);
    expect(r.broadcastSuggestion.text).toContain('kickoff-test');
    expect(r.broadcastSuggestion.text).toContain('alice');

    const research = await readFile(r.researchPath, 'utf-8');
    expect(research).toContain('# 研究:reduce p99 latency');
    expect(research).toContain('## 问题');

    const plan = await readFile(r.planPath, 'utf-8');
    expect(plan).toContain('cut p99 from 800ms to <400ms');
    expect(plan).toContain('DRI: alice');
  });
});
