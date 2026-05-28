import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { planUpgrade } from '../../src/tools/plan_upgrade.js';
import { MulticaClient } from '@tcmcp/shared';
import { STANDARD_LABEL_MAP, interceptAnyLabelAdd } from '@tcmcp/shared/test-helpers';

describe('plan_upgrade', () => {
  let dir: string;
  let agent: MockAgent;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pu-'));
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await agent.close();
  });

  it('bumps version, snapshots history, re-labels for review', async () => {
    const pool = agent.get('http://m.test');
    interceptAnyLabelAdd(pool);
    pool.intercept({ path: '/api/issues/issue_p1/labels', method: 'POST' }).reply(201, {}).times(2);

    const planPath = join(dir, 'plan_x.md');
    await writeFile(planPath, [
      '---', 'version: 1.0', '---',
      '# Plan: x', '', '## Goal', 'do x',
    ].join('\n'));

    const client = new MulticaClient({
      serverUrl: 'http://m.test', token: 't', workspaceId: 'w',
    labelMap: STANDARD_LABEL_MAP });

    const r = await planUpgrade({
      planPath, multicaIssueId: 'issue_p1',
      reason: 'realized X was wrong, need to redo Y',
    }, { client });

    expect(r.newVersion).toBe('1.1');
    expect(r.snapshotPath).toMatch(/plan_x_v1\.0\.md$/);

    const updated = await readFile(planPath, 'utf-8');
    expect(updated).toMatch(/version: 1\.1/);
    expect(updated).toContain('## Upgrade Log');
    expect(updated).toContain('1.0 → 1.1');
    expect(updated).toContain('realized X was wrong');

    const files = await readdir(dir);
    expect(files).toContain('plan_x_v1.0.md');
  });
});
