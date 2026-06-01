import { esc, renderShell } from './template-base.js';
import type { CaseCreateInput } from '../tools/case_create.js';

export function renderCaseHtml(input: CaseCreateInput): string {
  const crits = (input.criteriaResults ?? []).map((c) => {
    const mark = c.met ? '✅' : '❌';
    const reason = !c.met && c.notMetReason ? ` — ${esc(c.notMetReason)}` : '';
    return `<li>${mark} ${esc(c.criterion)}${reason}</li>`;
  }).join('');

  const judgments = (input.keyJudgments ?? []).map((j) => `<div class="field"><div class="field-label">判断:${esc(j.title)}</div>
<b>背景</b> ${esc(j.context)}<br>
<b>选项</b> ${esc((j.options ?? []).join(' / '))}<br>
<b>选择</b> ${esc(j.chose)}<br>
<b>事后看</b> ${esc(j.inHindsight)}<br>
<b>古法不可能</b> ${esc(j.ancientImpossible)}</div>`).join('\n');

  const rules = (input.ruleCandidates ?? []).length
    ? `<ul>${(input.ruleCandidates ?? []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : '_(无)_';

  const sections = [
    `<h2>1 · 目标</h2><div class="field">${esc(input.goal)}</div>`,
    `<h2>2 · 实际发生</h2><div class="field">${esc(input.whatHappened)}</div>`,
    `<h2>3 · 完成标准</h2><div class="field crit"><ul>${crits}</ul></div>`,
    `<h2>4 · 关键判断</h2>${judgments}`,
    `<h2>5 · 规则候选</h2><div class="field">${rules}</div>`,
  ].join('\n');

  return renderShell({
    eyebrow: 'CASE · 复盘',
    title: input.slug,
    metaItems: [{ label: 'Phase', value: 'RPI Debrief' }],
    sectionsHtml: sections,
    footer: 'team-context · RPI Debrief · SOP 非妥协 #2 · multica issue 内渲染',
  });
}
