import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { skillLint } from '../../src/tools/skill_lint.js';

describe('skill_lint', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sl-'));
    await mkdir(join(dir, 'good'), { recursive: true });
    await writeFile(
      join(dir, 'good', 'SKILL.md'),
      [
        '---',
        'name: good',
        'description: A skill that triggers on test.',
        'owner: alice@example.com',
        'last_reviewed_at: 2026-05-26',
        '---',
        '# Body',
        'short.',
      ].join('\n')
    );
    await mkdir(join(dir, 'no-owner'), { recursive: true });
    await writeFile(
      join(dir, 'no-owner', 'SKILL.md'),
      [
        '---',
        'name: no-owner',
        'description: Missing owner.',
        '---',
        '# Body',
      ].join('\n')
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('flags missing owner as warning', async () => {
    const r = await skillLint({ skillsDir: dir }, {});
    const noOwner = r.findings.find((f) => f.skill === 'no-owner');
    expect(noOwner?.warnings.some((w) => /owner/i.test(w))).toBe(true);

    const good = r.findings.find((f) => f.skill === 'good');
    expect(good?.errors).toEqual([]);
  });
});
