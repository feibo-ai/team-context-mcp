// packages/config/tests/env.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnvConfigSource } from '../src/env.js';

describe('EnvConfigSource', () => {
  const orig = { ...process.env };
  afterEach(() => { process.env = { ...orig }; });

  it('reads from process.env', async () => {
    process.env.FEISHU_TEAM_CHAT_ID = 'oc_xxx';
    const s = new EnvConfigSource({ prefix: '' });
    expect(s.get('FEISHU_TEAM_CHAT_ID')).toBe('oc_xxx');
  });

  it('treats *_SECRET keys as secrets', async () => {
    process.env.FEISHU_APP_SECRET = 'shh';
    const s = new EnvConfigSource({ prefix: '' });
    expect(await s.getSecret('FEISHU_APP_SECRET')).toBe('shh');
  });

  it('version always 1 (env source has no versioning)', () => {
    expect(new EnvConfigSource({ prefix: '' }).version()).toBe(1);
  });

  it('onChange is no-op (env doesnt change)', () => {
    const unsub = new EnvConfigSource({ prefix: '' }).onChange(() => {});
    expect(typeof unsub).toBe('function');
  });
});
