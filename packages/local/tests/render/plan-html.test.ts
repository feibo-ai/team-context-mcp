import { describe, it, expect } from 'vitest';
import { renderPlanHtml } from '../../src/render/plan-html.js';

describe('renderPlanHtml', () => {
  it('project plan 含 5 段 + 字段填充 + HTML escape', () => {
    const html = renderPlanHtml({
      slug: 'tetris-mvp', layer: 'project', dri: 'feibo',
      goal: '玩一局 <Tetris>', completionCriteria: ['单文件 index.html', '7 键'],
      appetite: '2-3 小时', exec: ['feibo'], reviewer: 'feibo', approach: 'vanilla JS',
    } as any);
    expect(html).toContain('tetris-mvp');
    expect(html).toContain('目标');
    expect(html).toContain('完成标准');
    expect(html).toContain('投入预算');
    expect(html).toContain('玩一局 &lt;Tetris&gt;');
    expect(html).toContain('单文件 index.html');
    expect(html).toContain('计划');
  });
  it('task layer 精简版仍产出合法 HTML', () => {
    const html = renderPlanHtml({ slug: 'quick-fix', layer: 'task', goal: 'fix bug', completionCriteria: ['done when green'] } as any);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('quick-fix');
  });
});
