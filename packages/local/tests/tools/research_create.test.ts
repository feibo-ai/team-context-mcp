import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { researchCreate } from '../../src/tools/research_create.js';
import { MulticaClient } from '@tcmcp/shared';
import { STANDARD_LABEL_MAP, interceptAnyLabelAdd } from '@tcmcp/shared/test-helpers';

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

  it('writes research HTML with question + creates issue + uploads attachment', async () => {
    const pool = agent.get('http://m.test');
    interceptAnyLabelAdd(pool);
    pool.intercept({ path: '/api/issues', method: 'POST' }).reply(201, { id: 'r_1', labels: ['research'] });

    const client = new MulticaClient({ serverUrl: 'http://m.test', token: 't', workspaceId: 'w', labelMap: STANDARD_LABEL_MAP });
    const uploadFile = vi.fn().mockResolvedValue({ id: 'att-1' });
    client.uploadFile = uploadFile;

    const r = await researchCreate({
      projectPath: dir,
      slug: 'cache-strategy',
      question: 'How should we restructure cache keys to handle hot keys at scale?',
    }, { client });

    expect(r.researchPath).toMatch(/docs\/research\/research_\d{4}-\d{2}-\d{2}_cache-strategy\.html$/);
    expect(r.multicaIssueId).toBe('r_1');

    const content = await readFile(r.researchPath, 'utf-8');
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('How should we restructure cache keys to handle hot keys at scale?');

    expect(uploadFile).toHaveBeenCalledTimes(1);
    const [uploadedContent, filename, issueId, contentType] = uploadFile.mock.calls[0];
    expect(uploadedContent).toBe(content);
    expect(filename).toMatch(/^research_\d{4}-\d{2}-\d{2}_cache-strategy_v1\.html$/);
    expect(issueId).toBe('r_1');
    expect(contentType).toBe('text/html');
    expect(r.attachmentId).toBe('att-1');
  });

  it('returns alreadyExisted=true on second call without rewriting the file', async () => {
    const pool = agent.get('http://m.test');
    interceptAnyLabelAdd(pool);
    // Both calls hit /api/issues — research_create always logs the issue, even on re-entry.
    pool.intercept({ path: '/api/issues', method: 'POST' }).reply(201, { id: 'r_a', labels: ['research'] }).persist();

    const client = new MulticaClient({ serverUrl: 'http://m.test', token: 't', workspaceId: 'w', labelMap: STANDARD_LABEL_MAP });
    client.uploadFile = vi.fn().mockResolvedValue({ id: 'att-1' });
    const args = {
      projectPath: dir,
      slug: 'cache-strategy',
      question: 'How should we restructure cache keys to handle hot keys at scale?',
    };

    const first = await researchCreate(args, { client });
    expect(first.alreadyExisted).toBe(false);

    // Mutate the file so we can prove the second call doesn't rewrite it.
    const { writeFile } = await import('node:fs/promises');
    await writeFile(first.researchPath, '# tampered — should survive idempotent re-call\n', 'utf-8');

    const second = await researchCreate(args, { client });
    expect(second.alreadyExisted).toBe(true);
    expect(second.researchPath).toBe(first.researchPath);

    const preserved = await readFile(first.researchPath, 'utf-8');
    expect(preserved).toBe('# tampered — should survive idempotent re-call\n');
  });
});
