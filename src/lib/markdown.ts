import matter from 'gray-matter';

export function parseFrontmatter(text: string): Record<string, unknown> {
  const { data } = matter(text);
  return data;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Return section body (text between `## Name` and next H2), trimmed. Or null. */
export function findSection(text: string, name: string): string | null {
  const pattern = new RegExp(
    `^##\\s+${escapeRegex(name)}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`,
    'm'
  );
  const m = text.match(pattern);
  if (!m) return null;
  return m[1].trim();
}

/** Replace section content. If section missing, return text unchanged. */
export function replaceSection(text: string, name: string, body: string): string {
  const pattern = new RegExp(
    `(^##\\s+${escapeRegex(name)}\\s*$)([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`,
    'm'
  );
  if (!pattern.test(text)) return text;
  return text.replace(pattern, `$1\n${body}\n\n`);
}

/** Replace if section exists, otherwise append at end. */
export function upsertSection(text: string, name: string, body: string): string {
  if (findSection(text, name) !== null) {
    return replaceSection(text, name, body);
  }
  const sep = text.endsWith('\n') ? '' : '\n';
  return `${text}${sep}\n## ${name}\n${body}\n`;
}
