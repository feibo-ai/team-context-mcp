import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, basename, join, extname } from 'node:path';
import { z } from 'zod';
import matter from 'gray-matter';
import type { MulticaClient } from '@tcmcp/shared';
import { upsertSection } from '@tcmcp/shared';

export const planUpgradeInput = z.object({
  planPath: z.string(),
  multicaIssueId: z.string(),
  reason: z.string().min(10),
});

export type PlanUpgradeInput = z.infer<typeof planUpgradeInput>;

export async function planUpgrade(
  raw: PlanUpgradeInput,
  deps: { client: MulticaClient }
): Promise<{ oldVersion: string; newVersion: string; snapshotPath: string }> {
  const input = planUpgradeInput.parse(raw);

  const text = await readFile(input.planPath, 'utf-8');
  const { data, content } = matter(text);
  // gray-matter parses YAML "1.0" as numeric 1, dropping ".0". Re-canonicalize.
  const oldVersionRaw = String(data.version ?? '1.0');
  const oldVersion = oldVersionRaw.includes('.') ? oldVersionRaw : `${oldVersionRaw}.0`;
  const newVersion = bumpVersion(oldVersion);

  // Snapshot
  const dir = dirname(input.planPath);
  const stem = basename(input.planPath, extname(input.planPath));
  const snapshotPath = join(dir, `${stem}_v${oldVersion}.md`);
  await copyFile(input.planPath, snapshotPath);

  // Update version. gray-matter quotes string values like '1.1'; write as
  // numeric where it round-trips so the YAML stays bare (`version: 1.1`).
  const numericVer = Number(newVersion);
  data.version = Number.isFinite(numericVer) && String(numericVer) === newVersion
    ? numericVer
    : newVersion;
  const ts = new Date().toISOString();
  const upgradeEntry = [
    `### ${ts} · ${oldVersion} → ${newVersion}`,
    '',
    `**原因**: ${input.reason}`,
    `**快照**: \`${basename(snapshotPath)}\``,
  ].join('\n');

  const existingLog = matter.stringify('', data); // get fresh frontmatter
  const upgradedBody = upsertSection(content, '升级日志', upgradeEntry);
  const newText = matter.stringify(upgradedBody, data);
  await writeFile(input.planPath, newText, 'utf-8');

  // Re-label multica issue: add 计划-已升级 + 计划-草稿 (addLabel only adds — it does
  // not remove 计划-已批准; the 计划-草稿 label is what signals it needs re-review).
  await deps.client.addLabel(input.multicaIssueId, '计划-已升级');
  await deps.client.addLabel(input.multicaIssueId, '计划-草稿');

  return { oldVersion, newVersion, snapshotPath };
}

function bumpVersion(v: string): string {
  const parts = v.split('.').map(Number);
  parts[1] = (parts[1] || 0) + 1;
  return parts.join('.');
}
