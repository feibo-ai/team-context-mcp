import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { monthlyHealthReport } from '../../src/tools/monthly_health_report.js';

describe('monthly_health_report', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mh-'));
    const g = simpleGit(dir);
    await g.init(['-b', 'main']);
    await g.addConfig('user.email', 'a@b');
    await g.addConfig('user.name', 'T');
    await writeFile(join(dir, 'CLAUDE.md'), 'short CLAUDE.md');
    await mkdir(join(dir, 'skills', 'x'), { recursive: true });
    await writeFile(join(dir, 'skills', 'x', 'SKILL.md'), '---\nname: x\ndescription: ok\n---\n');
    await g.add('-A');
    await g.commit('initial');
    await writeFile(join(dir, 'foo.txt'), 'a');
    await g.add('-A');
    await g.commit('wip: foo');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('produces markdown report with 5 sections', async () => {
    const r = await monthlyHealthReport({ teamContextRepo: dir }, {});
    expect(r.report).toContain('# Monthly Health Report');
    expect(r.report).toContain('## CLAUDE.md token count');
    expect(r.report).toContain('## /clear (wip:) count');
    expect(r.report).toMatch(/wip: foo/); // shows our wip commit
  });
});
