import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { researchCreate } from '../../src/tools/research_create.js';
import { MulticaClient } from '../../src/lib/multica.js';

describe('research_create', () => {
  let dir: string;
  let agent: MockAgent;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rc-'));
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await agent.close();
  });

  it('writes research skeleton with 4 dimensions + creates issue', async () => {
    const pool = agent.get('http://m.test');
    pool.intercept({ path: '/api/issues', method: 'POST' }).reply(201, { id: 'r_1', labels: ['research'] });

    const client = new MulticaClient({ serverUrl: 'http://m.test', token: 't', workspaceId: 'w' });
    const r = await researchCreate({
      projectPath: dir,
      slug: 'cache-strategy',
      question: 'How should we restructure cache keys to handle hot keys at scale?',
    }, { client });

    expect(r.researchPath).toMatch(/docs\/research\/research_\d{4}-\d{2}-\d{2}_cache-strategy\.md/);
    expect(r.multicaIssueId).toBe('r_1');

    const content = await readFile(r.researchPath, 'utf-8');
    expect(content).toContain('# Research:');
    expect(content).toContain('## Question');
    expect(content).toContain('### Existing codebase');
    expect(content).toContain('### Prior art');
    expect(content).toContain('### Pitfalls');
    expect(content).toContain('### Constraints');
    expect(content).toContain('## Open questions');
    expect(content).toContain('## Recommended approaches');
  });
});
