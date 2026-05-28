import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import simpleGit from 'simple-git';
import { skillLint } from './skill_lint.js';
import { estimateTokens } from '@tcmcp/shared';

export const monthlyHealthReportInput = z.object({
  teamContextRepo: z.string(),
  projectRepos: z.array(z.string()).default([]),
});

export type MonthlyHealthReportInput = z.infer<typeof monthlyHealthReportInput>;

export async function monthlyHealthReport(
  raw: MonthlyHealthReportInput,
  _deps: unknown
): Promise<{ report: string }> {
  const input = monthlyHealthReportInput.parse(raw);
  const date = new Date().toISOString().slice(0, 7); // YYYY-MM
  const since = new Date(Date.now() - 30 * 86400000).toISOString();

  const lines: string[] = [];
  lines.push(`# Monthly Health Report — ${date}`);
  lines.push('');

  // Indicator 1: CLAUDE.md token count
  try {
    const path = join(input.teamContextRepo, 'claude_md_team_global.md');
    const text = await readFile(path, 'utf-8');
    const t = estimateTokens(text);
    lines.push('## CLAUDE.md token count');
    lines.push(`- team-global: ~${t} tokens ${t > 3000 ? '⚠️ OVER 3K' : '✅'}`);
    lines.push('');
  } catch {
    lines.push('## CLAUDE.md token count');
    lines.push('- _(no claude_md_team_global.md found)_');
    lines.push('');
  }

  // Indicator 2: New rules this month (grep claude-md commits)
  const g = simpleGit(input.teamContextRepo);
  const log = await g.log({ '--since': since });
  const claudeCommits = log.all.filter((c) => /claude.?md|CLAUDE\.md/i.test(c.message));
  lines.push('## CLAUDE.md changes this month');
  if (claudeCommits.length === 0) {
    lines.push('- _(none — possibly under-learning, or skill via case_promote_rule with non-matching message)_');
  } else {
    for (const c of claudeCommits) lines.push(`- ${c.hash.slice(0, 7)} ${c.message}`);
  }
  lines.push('');

  // Indicator 3-4: skill lint findings
  const skillsDir = join(input.teamContextRepo, 'skills');
  try {
    await stat(skillsDir);
    const lint = await skillLint({ skillsDir }, {});
    lines.push('## Skill lint (stale + owner gaps)');
    for (const f of lint.findings) {
      const tag = f.errors.length ? '❌' : f.warnings.length ? '⚠️' : '✅';
      lines.push(`- ${tag} **${f.skill}** (~${f.tokens} tokens)`);
      for (const e of f.errors) lines.push(`  - ERROR: ${e}`);
      for (const w of f.warnings) lines.push(`  - WARN: ${w}`);
    }
    lines.push('');
  } catch {
    lines.push('## Skill lint');
    lines.push('- _(skills/ dir not found)_');
    lines.push('');
  }

  // Indicator 6: /clear (wip:) count
  const wipCommits = log.all.filter((c) => /^wip:/i.test(c.message));
  lines.push('## /clear (wip:) count');
  lines.push(`- ${wipCommits.length} wip: commits in last 30 days`);
  if (wipCommits.length > 50) lines.push('  - ⚠️ heavy restart pattern, check burnout');
  for (const c of wipCommits.slice(0, 10)) {
    lines.push(`  - ${c.hash.slice(0, 7)} ${c.message}`);
  }
  lines.push('');

  // Indicator 5: case-specific contamination in CLAUDE.md (heuristic)
  lines.push('## case-specific contamination check');
  lines.push('- _(heuristic: look for project names in CLAUDE.md — not implemented yet, run grep manually)_');
  lines.push('');

  return { report: lines.join('\n') };
}
