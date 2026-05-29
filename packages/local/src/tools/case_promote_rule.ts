import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { findSection, replaceSection } from '@tcmcp/shared';
import { estimateTokens } from '@tcmcp/shared';

export const casePromoteRuleInput = z.object({
  casePath: z.string(),
  ruleText: z.string().min(5),
  claudeMdPath: z.string(),
  section: z.string().default('Mistakes Claude must not repeat'),
});

export type CasePromoteRuleInput = z.infer<typeof casePromoteRuleInput>;

export async function casePromoteRule(
  raw: CasePromoteRuleInput,
  _deps: unknown
): Promise<{ appended: boolean; warning?: string }> {
  const input = casePromoteRuleInput.parse(raw);

  // 1. Read case file, find the matching candidate line
  const caseTxt = await readFile(input.casePath, 'utf-8');
  const linePattern = new RegExp(
    `^- \\[ \\] 待 DRI 决定是否晋升: ${escape(input.ruleText)}\\s*$`,
    'm'
  );
  if (!linePattern.test(caseTxt)) {
    throw new Error(`rule candidate not found in case file: "${input.ruleText}"`);
  }

  // 2. Append to CLAUDE.md target section
  const claudeMd = await readFile(input.claudeMdPath, 'utf-8');
  const existing = findSection(claudeMd, input.section) || '';
  const updated = replaceSection(
    claudeMd,
    input.section,
    `${existing}\n- ${input.ruleText}`.trim()
  );

  // 3. Token budget check
  const tokens = estimateTokens(updated);
  let warning: string | undefined;
  if (tokens > 3000) {
    warning =
      `CLAUDE.md will be ~${tokens} tokens after promotion (hard limit 3000). ` +
      `Prune before next promotion — see SOP P-4 monthly review.`;
  }

  await writeFile(input.claudeMdPath, updated, 'utf-8');

  // 4. Mark promoted in case file
  const today = new Date().toISOString().slice(0, 10);
  const newCase = caseTxt.replace(
    linePattern,
    `- [x] 已晋升 ${today}: ${input.ruleText}`
  );
  await writeFile(input.casePath, newCase, 'utf-8');

  return { appended: true, warning };
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
