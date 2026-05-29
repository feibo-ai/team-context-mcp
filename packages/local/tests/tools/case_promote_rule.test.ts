import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { casePromoteRule } from '../../src/tools/case_promote_rule.js';

describe('case_promote_rule', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cpr-'));
    await writeFile(join(dir, 'CLAUDE.md'), '# CLAUDE\n\n## Mistakes Claude must not repeat\n\n');
    await writeFile(
      join(dir, 'case.md'),
      [
        '# 复盘:foo',
        '',
        '## 5. 通用规则候选',
        '- [ ] 待 DRI 决定是否晋升: Always check X before Y',
        '- [ ] 待 DRI 决定是否晋升: Never Z on Mondays',
        '',
      ].join('\n')
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appends rule to CLAUDE.md and marks promoted in case', async () => {
    const r = await casePromoteRule(
      {
        casePath: join(dir, 'case.md'),
        ruleText: 'Always check X before Y',
        claudeMdPath: join(dir, 'CLAUDE.md'),
        section: 'Mistakes Claude must not repeat',
      },
      {}
    );

    expect(r.appended).toBe(true);

    const claudeMd = await readFile(join(dir, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toContain('Always check X before Y');

    const caseTxt = await readFile(join(dir, 'case.md'), 'utf-8');
    expect(caseTxt).toContain('[x] 已晋升 ' + new Date().toISOString().slice(0, 10));
  });
});
