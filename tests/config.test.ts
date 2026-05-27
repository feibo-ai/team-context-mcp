import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('reads env vars when present', async () => {
    process.env.MULTICA_SERVER_URL = 'http://env.test';
    process.env.MULTICA_TOKEN = 'mul_env';
    process.env.MULTICA_WORKSPACE_ID = 'ws_env';
    process.env.TEAM_CONTEXT_REPO = '/tmp/tc';

    const cfg = await loadConfig();
    expect(cfg.multica.serverUrl).toBe('http://env.test');
    expect(cfg.multica.token).toBe('mul_env');
    expect(cfg.multica.workspaceId).toBe('ws_env');
    expect(cfg.teamContextRepo).toBe('/tmp/tc');

    delete process.env.MULTICA_SERVER_URL;
    delete process.env.MULTICA_TOKEN;
    delete process.env.MULTICA_WORKSPACE_ID;
    delete process.env.TEAM_CONTEXT_REPO;
  });
});
