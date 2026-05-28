import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit, { SimpleGit } from 'simple-git';
import { GitOps } from '../src/git.js';

describe('GitOps', () => {
  let dir: string;
  let g: SimpleGit;
  let ops: GitOps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gitops-'));
    g = simpleGit(dir);
    await g.init(['-b', 'main']);
    await g.addConfig('user.email', 'test@example.com');
    await g.addConfig('user.name', 'Test');
    await writeFile(join(dir, 'README.md'), 'hello');
    await g.add('README.md');
    await g.commit('initial');
    ops = new GitOps(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('status returns empty for clean repo', async () => {
    const s = await ops.status();
    expect(s.uncommittedFiles).toEqual([]);
    expect(s.clean).toBe(true);
  });

  it('status lists modified files', async () => {
    await writeFile(join(dir, 'README.md'), 'changed');
    await writeFile(join(dir, 'new.md'), 'new');
    const s = await ops.status();
    expect(s.clean).toBe(false);
    expect(s.uncommittedFiles.sort()).toEqual(['README.md', 'new.md']);
  });

  it('commitWip creates a commit with wip: prefix', async () => {
    await writeFile(join(dir, 'a.md'), 'a');
    const hash = await ops.commitWip('refactor halfway');
    expect(hash).toMatch(/^[a-f0-9]{7,}$/);
    const last = await ops.lastCommit();
    expect(last.message).toBe('wip: refactor halfway');
  });

  it('commitWip refuses on clean repo', async () => {
    await expect(ops.commitWip('nothing')).rejects.toThrow(/nothing to commit/i);
  });
});
