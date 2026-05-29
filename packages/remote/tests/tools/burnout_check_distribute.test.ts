import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { burnoutCheckDistribute } from '../../src/tools/burnout_check_distribute.js';
import { MulticaClient } from '@tcmcp/shared';
import { STANDARD_LABEL_MAP, interceptAnyLabelAdd } from '@tcmcp/shared/test-helpers';

// FeishuClient is dependency-injected — no shell-out anymore. Each test wires
// a vi.fn()-backed stub that satisfies the methods the tool calls
// (dmSendByEmail for distribute, msgHistoryP2P for collect path B).
function makeFeishuStub(overrides: {
  dmSendByEmail?: ReturnType<typeof vi.fn>;
  msgHistoryP2P?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    dmSendByEmail: overrides.dmSendByEmail ?? vi.fn().mockResolvedValue({ messageId: 'om_1' }),
    msgHistoryP2P: overrides.msgHistoryP2P ?? vi.fn().mockResolvedValue([]),
  };
}

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

  it('stores anonymized responses and creates issue if any yes (path A: manual responses)', async () => {
    const pool = agent.get('http://m.test');
    interceptAnyLabelAdd(pool);
    pool.intercept({ path: '/api/issues', method: 'POST' }).reply(201, { id: 'br_1' });

    const client = new MulticaClient({
      serverUrl: 'http://m.test', token: 't', workspaceId: 'w',
    labelMap: STANDARD_LABEL_MAP });
    const feishu = makeFeishuStub();

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
    }, { client, feishu: feishu as never });

    expect(r.yesCount).toBeGreaterThan(0);
    expect(r.alertIssueId).toBe('br_1');

    const stored = await readFile(join(dir, 'health/burnout/2026-05.md'), 'utf-8');
    expect(stored).toContain('Q1 (疲惫): 1 yes');
    expect(stored).not.toMatch(/alice@x|bob@x/); // anonymized — no email in report
    // Path A skips FeishuClient entirely.
    expect(feishu.msgHistoryP2P).not.toHaveBeenCalled();
  });

  it('rejects collect with neither responses nor teamEmails', async () => {
    const client = new MulticaClient({
      serverUrl: 'http://m.test', token: 't', workspaceId: 'w',
    labelMap: STANDARD_LABEL_MAP });
    const feishu = makeFeishuStub();
    await expect(burnoutCheckDistribute({
      action: 'collect',
      month: '2026-05',
      teamContextRepo: dir,
      driEmail: 'alice@x',
    } as any, { client, feishu: feishu as never })).rejects.toThrow(/responses\[\] or teamEmails\[\]/);
  });

  it('distribute action DMs each team member via feishu.dmSendByEmail (no shell-out)', async () => {
    const client = new MulticaClient({
      serverUrl: 'http://m.test', token: 't', workspaceId: 'w',
    labelMap: STANDARD_LABEL_MAP });
    const feishu = makeFeishuStub();

    const r = await burnoutCheckDistribute({
      action: 'distribute',
      month: '2026-05',
      teamEmails: ['alice@x', 'bob@x', 'carol@x'],
    }, { client, feishu: feishu as never });

    expect(r).toEqual({ sentCount: 3, failedEmails: [] });
    expect(feishu.dmSendByEmail).toHaveBeenCalledTimes(3);
    // Each call should target a team email with a text body (no card).
    for (const email of ['alice@x', 'bob@x', 'carol@x']) {
      expect(feishu.dmSendByEmail).toHaveBeenCalledWith(
        expect.objectContaining({ email, text: expect.stringContaining('倦怠检查') }),
      );
    }
  });

  it('distribute action records failures per email when feishu rejects', async () => {
    const client = new MulticaClient({
      serverUrl: 'http://m.test', token: 't', workspaceId: 'w',
    labelMap: STANDARD_LABEL_MAP });
    // Reject the second call; resolve the others.
    const dmSendByEmail = vi.fn()
      .mockResolvedValueOnce({ messageId: 'om_1' })
      .mockRejectedValueOnce(new Error('feishu offline'))
      .mockResolvedValueOnce({ messageId: 'om_3' });
    const feishu = makeFeishuStub({ dmSendByEmail });

    const r = await burnoutCheckDistribute({
      action: 'distribute',
      month: '2026-05',
      teamEmails: ['alice@x', 'bob@x', 'carol@x'],
    }, { client, feishu: feishu as never });

    expect(r).toEqual({ sentCount: 2, failedEmails: ['bob@x'] });
  });

  it('collect path B auto-scrapes via feishu.msgHistoryP2P and aggregates anonymously', async () => {
    const pool = agent.get('http://m.test');
    interceptAnyLabelAdd(pool);
    pool.intercept({ path: '/api/issues', method: 'POST' }).reply(201, { id: 'br_b' });

    const client = new MulticaClient({
      serverUrl: 'http://m.test', token: 't', workspaceId: 'w',
    labelMap: STANDARD_LABEL_MAP });

    // alice replies yes/no/no, bob replies no/yes/no, carol does not reply.
    const msgHistoryP2P = vi.fn(async (p: { email: string }) => {
      if (p.email === 'alice@x') {
        return [{ content: 'q1: yes', sender: 'ou_a' }, { content: 'q2: no\nq3: no', sender: 'ou_a' }];
      }
      if (p.email === 'bob@x') {
        return [{ content: 'q1: no q2: yes q3: no', sender: 'ou_b' }];
      }
      return []; // carol silent
    });
    const feishu = makeFeishuStub({ msgHistoryP2P });

    const r = await burnoutCheckDistribute({
      action: 'collect',
      month: '2026-05',
      teamContextRepo: dir,
      teamEmails: ['alice@x', 'bob@x', 'carol@x'],
      driEmail: 'alice@x',
    }, { client, feishu: feishu as never });

    expect(r.yesCount).toBe(2); // alice q1 + bob q2
    expect(r.alertIssueId).toBe('br_b');

    // msgHistoryP2P called once per teamEmail with the right sinceISO and limit.
    expect(msgHistoryP2P).toHaveBeenCalledTimes(3);
    expect(msgHistoryP2P).toHaveBeenCalledWith({ email: 'alice@x', sinceISO: '2026-05-01', limit: 50 });
    expect(msgHistoryP2P).toHaveBeenCalledWith({ email: 'bob@x',   sinceISO: '2026-05-01', limit: 50 });
    expect(msgHistoryP2P).toHaveBeenCalledWith({ email: 'carol@x', sinceISO: '2026-05-01', limit: 50 });

    const stored = await readFile(join(dir, 'health/burnout/2026-05.md'), 'utf-8');
    // Only 2 of 3 members replied with parseable data.
    expect(stored).toContain('**回复数**: 2');
    expect(stored).toContain('Q1 (疲惫): 1 yes');
    expect(stored).toContain('Q2 (反感通知): 1 yes');
    expect(stored).toContain('Q3 (下班还想 session): 0 yes');
    // Anonymized — no email in report.
    expect(stored).not.toMatch(/alice@x|bob@x|carol@x/);
  });
});
