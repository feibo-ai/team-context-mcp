import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import matter from 'gray-matter';
import { estimateTokens } from '@tcmcp/shared';

export const skillLintInput = z.object({
  skillsDir: z.string(),
});

export type SkillLintInput = z.infer<typeof skillLintInput>;

export interface SkillFinding {
  skill: string;
  errors: string[];
  warnings: string[];
  tokens: number;
}

export async function skillLint(
  raw: SkillLintInput,
  _deps: unknown
): Promise<{ findings: SkillFinding[] }> {
  const input = skillLintInput.parse(raw);
  const entries = await readdir(input.skillsDir);
  const findings: SkillFinding[] = [];

  for (const entry of entries) {
    const subPath = join(input.skillsDir, entry);
    const st = await stat(subPath);
    if (!st.isDirectory()) continue;
    const skillFile = join(subPath, 'SKILL.md');
    let text: string;
    try {
      text = await readFile(skillFile, 'utf-8');
    } catch {
      continue;
    }
    const { data, content: body } = matter(text);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!data.name) errors.push('missing frontmatter: name');
    if (!data.description) errors.push('missing frontmatter: description');
    if (!data.owner) warnings.push('missing frontmatter: owner (SOP ❌5)');
    if (!data.last_reviewed_at) {
      warnings.push('missing frontmatter: last_reviewed_at (SOP ❌5)');
    } else {
      const days = (Date.now() - new Date(String(data.last_reviewed_at)).getTime()) / 86400000;
      if (days > 90) warnings.push(`last_reviewed_at is ${Math.floor(days)} days old (>90)`);
    }

    const tokens = estimateTokens(body);
    if (tokens > 2000) errors.push(`body ~${tokens} tokens (hard limit 2000)`);

    findings.push({ skill: entry, errors, warnings, tokens });
  }

  return { findings };
}
