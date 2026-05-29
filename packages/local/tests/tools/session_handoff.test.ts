import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { sessionHandoff } from '../../src/tools/session_handoff.js';

describe('session_handoff', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sh-'));
    const g = simpleGit(dir);
    await g.init(['-b', 'main']);
    await g.addConfig('user.email', 'a@b');
    await g.addConfig('user.name', 'Test');
    await writeFile(join(dir, 'README.md'), 'r');
    await g.add('-A');
    await g.commit('initial');

    await mkdir(join(dir, 'docs', 'plans'), { recursive: true });
    await writeFile(
      join(dir, 'docs', 'plans', 'plan_2026-05-26_x.md'),
      [
        '# Plan: x',
        '',
        '## Goal',
        'do x',
        '',
      ].join('\n')
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('commits WIP and writes Current State section', async () => {
    await writeFile(join(dir, 'changed.txt'), 'wip');

    const r = await sessionHandoff(
      {
        projectPath: dir,
        currentState: 'wrote foo()',
        nextAction: 'wire bar() into baz.ts',
        pollutionSignal: 'You-are-right loop',
        deadEnds: ['tried mock-X — broke type checker'],
        wipStrategy: 'commit',
        wipMessage: 'mid-refactor',
      },
      {}
    );

    expect(r.commitHash).toMatch(/^[a-f0-9]{7,}$/);
    expect(r.planPath).toContain('plan_2026-05-26_x.md');

    const updated = await readFile(r.planPath, 'utf-8');
    expect(updated).toContain('## 当前状态');
    expect(updated).toContain('wrote foo()');
    expect(updated).toContain('wire bar() into baz.ts');
    expect(updated).toContain('tried mock-X');
    expect(updated).toContain('You-are-right loop');
  });
});
