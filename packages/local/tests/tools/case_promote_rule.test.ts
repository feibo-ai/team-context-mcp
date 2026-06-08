import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  casePromoteRule,
  casePromoteRuleInput,
} from '../../src/tools/case_promote_rule.js';

const TODAY = new Date().toISOString().slice(0, 10);

// Mirrors the real 方案A HTML case shape: <h2>N · 规则候选</h2> + <ul><li>…</li></ul>.
const HTML_CASE = [
  '<!doctype html><html><body>',
  '<h1>复盘:foo</h1>',
  '<h2>4 · 关键判断</h2><div class="field">…</div>',
  '<h2>5 · 规则候选</h2><div class="field"><ul>',
  '<li>Tailwind v4 + next/font 接字体走 @theme inline 让 font-sans 工具类直接内联 var(--font-xxx)。</li>',
  '<li>OKLCH 对比度走查用 canvas fillStyle 强转 sRGB 再算 WCAG。</li>',
  '</ul></div>',
  '<footer>team-context · RPI Debrief</footer>',
  '</body></html>',
].join('\n');

describe('case_promote_rule', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cpr-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ---- markdown case (back-compat) ----
  it('markdown case: appends rule to CLAUDE.md and marks promoted', async () => {
    await writeFile(
      join(dir, 'CLAUDE.md'),
      '# CLAUDE\n\n## Mistakes Claude must not repeat\n\n'
    );
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
    expect(claudeMd).toContain('- Always check X before Y');
    const caseTxt = await readFile(join(dir, 'case.md'), 'utf-8');
    expect(caseTxt).toContain(`[x] 已晋升 ${TODAY}: Always check X before Y`);
    // sibling candidate untouched
    expect(caseTxt).toContain('- [ ] 待 DRI 决定是否晋升: Never Z on Mondays');
  });

  // ---- HTML case (方案A · the real format) ----
  it('HTML case: extracts <li> candidate, promotes, marks 已晋升', async () => {
    await writeFile(
      join(dir, 'CLAUDE.md'),
      '# CLAUDE\n\n## Claude 不能再犯的错\n\n'
    );
    await writeFile(join(dir, 'case.html'), HTML_CASE);

    const rule =
      'Tailwind v4 + next/font 接字体走 @theme inline 让 font-sans 工具类直接内联 var(--font-xxx)。';
    const r = await casePromoteRule(
      {
        casePath: join(dir, 'case.html'),
        ruleText: rule,
        claudeMdPath: join(dir, 'CLAUDE.md'),
        section: 'Claude 不能再犯的错',
      },
      {}
    );

    expect(r.appended).toBe(true);
    const claudeMd = await readFile(join(dir, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toContain(`- ${rule}`);
    const caseTxt = await readFile(join(dir, 'case.html'), 'utf-8');
    expect(caseTxt).toContain(`<li>[已晋升 ${TODAY}] ${rule}</li>`);
    // sibling candidate untouched
    expect(caseTxt).toContain(
      '<li>OKLCH 对比度走查用 canvas fillStyle 强转 sRGB 再算 WCAG。</li>'
    );
  });

  it('HTML case: matches despite surrounding whitespace differences', async () => {
    await writeFile(
      join(dir, 'CLAUDE.md'),
      '# CLAUDE\n\n## Claude 不能再犯的错\n\n'
    );
    await writeFile(join(dir, 'case.html'), HTML_CASE);

    const r = await casePromoteRule(
      {
        casePath: join(dir, 'case.html'),
        ruleText: '   OKLCH 对比度走查用 canvas fillStyle 强转 sRGB 再算 WCAG。  ',
        claudeMdPath: join(dir, 'CLAUDE.md'),
        section: 'Claude 不能再犯的错',
      },
      {}
    );
    expect(r.appended).toBe(true);
    const claudeMd = await readFile(join(dir, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toContain('OKLCH 对比度走查');
  });

  it('not-found error lists the available candidates', async () => {
    await writeFile(
      join(dir, 'CLAUDE.md'),
      '# CLAUDE\n\n## Claude 不能再犯的错\n\n'
    );
    await writeFile(join(dir, 'case.html'), HTML_CASE);

    await expect(
      casePromoteRule(
        {
          casePath: join(dir, 'case.html'),
          ruleText: 'a rule that was never a candidate',
          claudeMdPath: join(dir, 'CLAUDE.md'),
          section: 'Claude 不能再犯的错',
        },
        {}
      )
    ).rejects.toThrow(/rule candidate not found[\s\S]*Tailwind v4/);
  });

  it('upsert: creates the target section when CLAUDE.md lacks it (no silent drop)', async () => {
    await writeFile(join(dir, 'CLAUDE.md'), '# CLAUDE\n\nsome preamble\n');
    await writeFile(join(dir, 'case.html'), HTML_CASE);

    const r = await casePromoteRule(
      {
        casePath: join(dir, 'case.html'),
        ruleText: 'OKLCH 对比度走查用 canvas fillStyle 强转 sRGB 再算 WCAG。',
        claudeMdPath: join(dir, 'CLAUDE.md'),
        section: 'Claude 不能再犯的错',
      },
      {}
    );
    expect(r.appended).toBe(true);
    const claudeMd = await readFile(join(dir, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toContain('## Claude 不能再犯的错');
    expect(claudeMd).toContain('OKLCH 对比度走查');
  });

  it('default section matches the team CLAUDE.md heading', () => {
    const parsed = casePromoteRuleInput.parse({
      casePath: 'x',
      ruleText: 'hello world',
      claudeMdPath: 'y',
    });
    expect(parsed.section).toBe('Claude 不能再犯的错');
  });
});
