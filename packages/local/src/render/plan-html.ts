import { esc, renderShell } from './template-base.js';
import type { PlanCreateInput } from '../tools/plan_create.js';

/**
 * Optional handoff/Current-State payload. When passed to renderPlanHtml the
 * regenerated plan carries the session-handoff snapshot as its own section, so
 * the durable plan doc — not just the issue comment — reflects where work
 * paused (matches the "handoff slot" the tc-3-plan skill documents).
 */
export interface HandoffState {
  at: string;
  lastCommit: string;
  branch: string;
  done: string;
  nextAction: string;
  deadEnds: string[];
  pollutionSignal: string;
}

export function renderPlanHtml(input: PlanCreateInput, handoff?: HandoffState): string {
  const crit = (input.completionCriteria ?? []).map((c) => `<li>${esc(c)}</li>`).join('');
  const exec = (input.exec ?? []).join(', ') || '(未分配)';
  const collab = (input.collab ?? []).join(', ') || '(无)';
  const reviewer = input.reviewer || '(待指派)';

  const sections = [
    `<h2>目标</h2><div class="field"><div class="field-label">Goal</div>${esc(input.goal)}</div>`,
    `<h2>完成标准</h2><div class="field crit"><ul>${crit}</ul></div>`,
    `<h2>分工</h2><div class="field"><div class="field-label">Roles</div>DRI <code>${esc(input.dri ?? '(指派)')}</code> · EXEC <code>${esc(exec)}</code> · COLLAB <code>${esc(collab)}</code> · REVIEW <code>${esc(reviewer)}</code></div>`,
    `<h2>投入预算</h2><div class="callout"><b>${esc(input.appetite ?? '(设定)')}</b> · 超时触发 plan_upgrade(升版强制重审)。</div>`,
    input.approach ? `<h2>方案</h2><div class="field">${esc(input.approach)}</div>` : '',
    handoff ? renderHandoff(handoff) : '',
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

function renderHandoff(h: HandoffState): string {
  const dead = h.deadEnds.length
    ? `<ul>${h.deadEnds.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`
    : '(无)';
  return [
    `<h2>当前状态 · handoff @ ${esc(h.at)}</h2>`,
    `<div class="callout">`,
    `<div class="field-label">Last commit</div><code>${esc(h.lastCommit)}</code> · <code>${esc(h.branch)}</code>`,
    `<div class="field-label">What's done</div>${esc(h.done)}`,
    `<div class="field-label">Next action</div>${esc(h.nextAction)}`,
    `<div class="field-label">Dead ends — do NOT retry</div>${dead}`,
    `<div class="field-label">Pollution signal</div>${esc(h.pollutionSignal)}`,
    `</div>`,
  ].join('\n');
}
