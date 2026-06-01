import { esc, renderShell } from './template-base.js';
import type { PlanCreateInput } from '../tools/plan_create.js';

export function renderPlanHtml(input: PlanCreateInput): string {
  const crit = (input.completionCriteria ?? []).map((c) => `<li>${esc(c)}</li>`).join('');
  const exec = (input.exec ?? []).join(', ') || '_(未分配)_';
  const collab = (input.collab ?? []).join(', ') || '_(无)_';
  const reviewer = input.reviewer || '_(待指派)_';

  const sections = [
    `<h2>目标</h2><div class="field"><div class="field-label">Goal</div>${esc(input.goal)}</div>`,
    `<h2>完成标准</h2><div class="field crit"><ul>${crit}</ul></div>`,
    `<h2>分工</h2><div class="field"><div class="field-label">Roles</div>DRI <code>${esc(input.dri ?? '_(指派)_')}</code> · EXEC <code>${esc(exec)}</code> · COLLAB <code>${esc(collab)}</code> · REVIEW <code>${esc(reviewer)}</code></div>`,
    `<h2>投入预算</h2><div class="callout"><b>${esc(input.appetite ?? '_(设定)_')}</b> · 超时触发 plan_upgrade(升版强制重审)。</div>`,
    input.approach ? `<h2>方案</h2><div class="field">${esc(input.approach)}</div>` : '',
  ].join('\n');

  return renderShell({
    eyebrow: `PLAN · 计划 · ${input.layer === 'task' ? 'task' : 'project'}`,
    title: input.slug,
    metaItems: [
      { label: 'DRI', value: input.dri ?? '—' },
      { label: 'Layer', value: input.layer },
      { label: 'Appetite', value: input.appetite ?? '—' },
    ],
    sectionsHtml: sections,
    footer: 'team-context · RPI Plan phase · multica issue 内渲染',
  });
}
