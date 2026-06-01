import { describe, it, expect } from 'vitest';
import { esc, renderShell } from '../../src/render/template-base.js';

describe('template-base', () => {
  it('esc 转义 HTML 特殊字符', () => {
    expect(esc('<a> & "b" \'c\'')).toBe('&lt;a&gt; &amp; &quot;b&quot; &#39;c&#39;');
  });

  it('renderShell 产出自包含 HTML · 含标题/eyebrow/section · 系统字体无外链', () => {
    const html = renderShell({
      eyebrow: 'PLAN · 计划',
      title: 'demo-slug',
      metaItems: [{ label: 'DRI', value: 'feibo' }],
      sectionsHtml: '<h2>目标</h2><div class="field">x</div>',
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('demo-slug');
    expect(html).toContain('PLAN · 计划');
    expect(html).toContain('<h2>目标</h2>');
    expect(html).toContain('Songti SC');
    expect(html).not.toContain('fonts.googleapis');
    expect(html).not.toContain('http://');
  });
});
