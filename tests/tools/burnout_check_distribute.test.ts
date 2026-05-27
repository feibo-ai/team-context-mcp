import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { burnoutCheckDistribute } from '../../src/tools/burnout_check_distribute.js';
import { MulticaClient } from '../../src/lib/multica.js';

describe('burnout_check_distribute', () => {
  let dir: string;
  let agent: MockAgent;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bc-'));
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
  });

  afterEach(async () => { await rm(dir, { recursive: true, force: true }); await agent.close(); });

  // Note: distribute action shells out to `feishu-cli msg send` per email.
  // Test below covers collect with caller-supplied responses (path A, no shell-out needed).
  // The feishu-cli auto-scrape path (path B) is covered by a manual E2E smoke test
  // recorded in SMOKE.md, since it requires real feishu-cli config.

  it('stores anonymized responses and creates issue if any yes (path A: manual responses)', async () => {
    const pool = agent.get('http://m.test');
    pool.intercept({ path: '/api/issues', method: 'POST' }).reply(201, { id: 'br_1' });

    const client = new MulticaClient({
      serverUrl: 'http://m.test', token: 't', workspaceId: 'w',
    });

    const r = await burnoutCheckDistribute({
      action: 'collect',
      month: '2026-05',
      teamContextRepo: dir,
      responses: [
        { q1: 'yes', q2: 'no', q3: 'no' },
        { q1: 'no',  q2: 'no', q3: 'no' },
        { q1: 'no',  q2: 'no', q3: 'no' },
      ],
      driEmail: 'alice@x',
    }, { client });

    expect(r.yesCount).toBeGreaterThan(0);
    expect(r.alertIssueId).toBe('br_1');

    const stored = await readFile(join(dir, 'health/burnout/2026-05.md'), 'utf-8');
    expect(stored).toContain('Q1 (疲惫): 1 yes');
    expect(stored).not.toMatch(/alice@x|bob@x/); // anonymized — no email in report
  });

  it('rejects collect with neither responses nor teamEmails', async () => {
    const client = new MulticaClient({
      serverUrl: 'http://m.test', token: 't', workspaceId: 'w',
    });
    await expect(burnoutCheckDistribute({
      action: 'collect',
      month: '2026-05',
      teamContextRepo: dir,
      driEmail: 'alice@x',
    } as any, { client })).rejects.toThrow(/responses\[\] or teamEmails\[\]/);
  });
});
