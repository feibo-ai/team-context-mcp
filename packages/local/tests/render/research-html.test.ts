import { describe, it, expect } from 'vitest';
import { renderResearchHtml } from '../../src/render/research-html.js';

describe('renderResearchHtml', () => {
  it('含问题段 + escape + 自包含', () => {
    const html = renderResearchHtml({ slug: 'r-test', question: 'how to <x>?' } as any);
    expect(html).toContain('r-test');
    expect(html).toContain('问题');
    expect(html).toContain('how to &lt;x&gt;?');
    expect(html).toContain('RESEARCH · 研究');
    expect(html).toContain('<!DOCTYPE html>');
  });
});
