import type { z } from 'zod';
import { esc, renderShell } from './template-base.js';
import type { researchCreateInput } from '../tools/research_create.js';

type ResearchCreateInput = z.infer<typeof researchCreateInput>;

export function renderResearchHtml(input: ResearchCreateInput): string {
  const sections = [
    `<h2>问题</h2><div class="field"><div class="field-label">Question</div>${esc(input.question)}</div>`,
    `<h2>发现</h2><div class="field"><div class="field-label">Findings</div>_(待 fresh session 深度调研填充)_</div>`,
    `<h2>待解问题</h2><div class="field">_(research 过程中浮现的开放问题)_</div>`,
  ].join('\n');

  return renderShell({
    eyebrow: 'RESEARCH · 研究',
    title: input.slug,
    metaItems: [{ label: 'Phase', value: 'RPI Research' }],
    sectionsHtml: sections,
    footer: 'team-context · RPI Research phase · multica issue 内渲染',
  });
}
