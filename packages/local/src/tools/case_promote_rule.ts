import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { findSection, upsertSection, estimateTokens } from '@tcmcp/shared';

export const casePromoteRuleInput = z.object({
  casePath: z.string(),
  ruleText: z.string().min(5),
  claudeMdPath: z.string(),
  // Team CLAUDE.md keeps promoted rules under this heading (see the global
  // team-context CLAUDE.md). Override for project-local CLAUDE.md files.
  section: z.string().default('Claude 不能再犯的错'),
});

export type CasePromoteRuleInput = z.infer<typeof casePromoteRuleInput>;

/** One promotable rule found in a case file. */
interface Candidate {
  /** Exact substring in the case file — used for the mark-promoted rewrite. */
  raw: string;
  /** Clean canonical rule text (tags stripped, entities decoded, ws collapsed). */
  text: string;
  /** True when sourced from an HTML <li>, false from a markdown checkbox line. */
  html: boolean;
}

export async function casePromoteRule(
  raw: CasePromoteRuleInput,
  _deps: unknown
): Promise<{ appended: boolean; warning?: string }> {
  const input = casePromoteRuleInput.parse(raw);

  // 1. Read case + extract rule candidates. Cases are HTML now (方案A · the
  //    "规则候选" <li> list); older cases are markdown ("- [ ] 待 DRI 决定是否晋升:
  //    …"). Run both extractors so either format works without guessing.
  const caseTxt = await readFile(input.casePath, 'utf-8');
  const candidates = [
    ...extractHtmlCandidates(caseTxt),
    ...extractMarkdownCandidates(caseTxt),
  ];

  // Match on normalized text so tag / whitespace differences don't matter. A
  // genuine reword still won't match — the error lists the exact candidates to
  // copy, rather than silently promoting the wrong wording.
  const want = normalizeRule(input.ruleText);
  const match = candidates.find((c) => normalizeRule(c.text) === want);
  if (!match) {
    const list = candidates.length
      ? candidates.map((c) => `  • ${c.text}`).join('\n')
      : '  (none — no "规则候选" <li> items or "- [ ] 待 DRI 决定是否晋升:" lines)';
    throw new Error(
      `rule candidate not found in case file: "${input.ruleText}"\n` +
        `available candidates in ${input.casePath}:\n${list}`
    );
  }

  // 2. Append the canonical candidate text to the CLAUDE.md section. upsert so a
  //    missing heading is created instead of silently dropping the rule
  //    (replaceSection no-ops when the heading is absent).
  const claudeMd = await readFile(input.claudeMdPath, 'utf-8');
  const existing = findSection(claudeMd, input.section);
  const body = existing ? `${existing}\n- ${match.text}` : `- ${match.text}`;
  const updated = upsertSection(claudeMd, input.section, body);

  // 3. Token budget check (CLAUDE.md hard limit 3000).
  const tokens = estimateTokens(updated);
  let warning: string | undefined;
  if (tokens > 3000) {
    warning =
      `CLAUDE.md will be ~${tokens} tokens after promotion (hard limit 3000). ` +
      `Prune before next promotion — see SOP P-4 monthly review.`;
  }
  await writeFile(input.claudeMdPath, updated, 'utf-8');

  // 4. Mark promoted in the case file so it can't be double-promoted. Use a
  //    function replacer so a literal '$' in the rule text is never treated as
  //    a replacement backreference.
  const today = new Date().toISOString().slice(0, 10);
  const promoted = markPromoted(match, today);
  const newCase = caseTxt.replace(match.raw, () => promoted);
  await writeFile(input.casePath, newCase, 'utf-8');

  return { appended: true, warning };
}

/** Pull `<li>` items from the "规则候选" section of an HTML case. */
function extractHtmlCandidates(html: string): Candidate[] {
  const headIdx = html.search(/规则候选/);
  if (headIdx === -1) return [];
  let section = html.slice(headIdx);
  // Bound to this section: stop at the next opening <h2 …> or the <footer>.
  // (`</h2>` of the current heading does not match `<h2\b`.)
  const boundary = section.search(/<h2\b|<footer\b/i);
  if (boundary !== -1) section = section.slice(0, boundary);

  const out: Candidate[] = [];
  const re = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) {
    const text = normalizeRule(m[1]);
    if (text.length >= 5 && !text.startsWith('[已晋升')) {
      out.push({ raw: m[0], text, html: true });
    }
  }
  return out;
}

/** Pull `- [ ] 待 DRI 决定是否晋升: …` lines from a markdown case. */
function extractMarkdownCandidates(md: string): Candidate[] {
  const out: Candidate[] = [];
  const re = /^- \[ \] 待 DRI 决定是否晋升: (.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    out.push({ raw: m[0], text: m[1].trim(), html: false });
  }
  return out;
}

/** Render the case-file marker that records a candidate as promoted. */
function markPromoted(c: Candidate, date: string): string {
  if (c.html) {
    // Prefix the <li> body with the marker, keep the element intact.
    return c.raw.replace(
      /(<li\b[^>]*>)([\s\S]*?)(<\/li>)/i,
      `$1[已晋升 ${date}] $2$3`
    );
  }
  return `- [x] 已晋升 ${date}: ${c.text}`;
}

/** Strip tags + decode the handful of entities our HTML templates emit. */
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Canonical form for matching: tags out, whitespace collapsed, trimmed. */
function normalizeRule(s: string): string {
  return stripHtml(s).replace(/\s+/g, ' ').trim();
}
