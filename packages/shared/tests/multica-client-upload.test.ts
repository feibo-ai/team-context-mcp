import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { MulticaClient } from '../src/multica-client.js';

describe('uploadFile', () => {
  let agent: MockAgent;
  let originalDispatcher: ReturnType<typeof getGlobalDispatcher>;

  beforeEach(() => {
    originalDispatcher = getGlobalDispatcher();
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
  });

  afterEach(async () => {
    setGlobalDispatcher(originalDispatcher);
    await agent.close();
  });

  it('POST /api/upload-file multipart · 返回 attachment id', async () => {
    const pool = agent.get('http://multica.test');
    pool
      .intercept({ path: '/api/upload-file', method: 'POST' })
      .reply(200, { id: 'att-1', filename: 'plan.html', content_type: 'text/html' });

    const c = new MulticaClient({
      serverUrl: 'http://multica.test',
      token: 't',
      workspaceId: 'ws',
    });
    const r = await c.uploadFile('<html>x</html>', 'plan.html', 'issue-9');
    expect(r.id).toBe('att-1');
  });
});
