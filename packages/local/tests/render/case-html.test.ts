import { describe, it, expect } from 'vitest';
import { renderCaseHtml } from '../../src/render/case-html.js';

describe('renderCaseHtml', () => {
  it('含 5 段 SOP case + judgments + escape', () => {
    const html = renderCaseHtml({
      slug: 'c-test', goal: 'ship <thing>', whatHappened: 'did <stuff>',
      criteriaResults: [{ criterion: 'crit-1', met: true }, { criterion: 'crit-2', met: false, notMetReason: 'blocked' }],
      keyJudgments: [{ title: 'J1', context: 'ctx', options: ['A', 'B'], chose: 'A', inHindsight: 'ok', ancientImpossible: 'yes' }],
      ruleCandidates: ['rule x'],
    } as any);
    expect(html).toContain('c-test');
    expect(html).toContain('目标');
    expect(html).toContain('实际发生');
    expect(html).toContain('完成标准');
    expect(html).toContain('关键判断');
    expect(html).toContain('规则候选');
    expect(html).toContain('ship &lt;thing&gt;');
    expect(html).toContain('crit-1');
    expect(html).toContain('J1');
    expect(html).toContain('CASE · 复盘');
  });
});
