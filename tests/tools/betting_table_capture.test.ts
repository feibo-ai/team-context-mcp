import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { bettingTableCapture } from '../../src/tools/betting_table_capture.js';
import { MulticaClient } from '../../src/lib/multica.js';

describe('betting_table_capture', () => {
  let agent: MockAgent;

  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
  });

  afterEach(async () => { await agent.close(); });

  it('creates issue with proposals + label betting-table', async () => {
    const pool = agent.get('http://m.test');
    pool.intercept({ path: '/api/issues', method: 'POST' })
      .reply(201, { id: 'bt_1', labels: ['betting-table'] });

    const client = new MulticaClient({
      serverUrl: 'http://m.test', token: 't', workspaceId: 'w',
    });

    const r = await bettingTableCapture({
      action: 'open',
      proposals: [
        { id: 'p1', title: 'Refactor auth', proposer: 'alice' },
        { id: 'p2', title: 'Add OAuth', proposer: 'bob' },
      ],
      weekOf: '2026-05-26',
    }, { client });

    expect(r.bettingIssueId).toBe('bt_1');
    expect(r.proposalsCount).toBe(2);
  });
});
