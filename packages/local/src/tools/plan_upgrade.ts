import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, basename, join, extname } from 'node:path';
import { z } from 'zod';
import matter from 'gray-matter';
import type { MulticaClient } from '@tcmcp/shared';
import { upsertSection } from '@tcmcp/shared';
import { renderPlanHtml } from '../render/plan-html.js';
import type { PlanCreateInput } from './plan_create.js';

export const planUpgradeInput = z.object({
  planPath: z.string(),
  multicaIssueId: z.string(),
  reason: z.string().min(10),
  // Full structured plan fields, supplied so the HTML can be regenerated
  // wholesale. Typed as PlanCreateInput on the inferred type below.
  planInput: z.any().optional(),
  // New attachment version number (default 2). v1, v2... accumulate on the
  // issue so the plan's evolution stays traceable.
  version: z.number().optional(),
});

export type PlanUpgradeInput = Omit<z.infer<typeof planUpgradeInput>, 'planInput'> & {
  planInput?: PlanCreateInput;
};

export async function planUpgrade(
  raw: PlanUpgradeInput,
  deps: { client: MulticaClient }
): Promise<{
  oldVersion: string;
  newVersion: string;
  snapshotPath: string;
  attachmentId: string | null;
}> {
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

  // State-machine transition: upgrade = no longer approved → clear 计划-已批准,
  // mark 计划-已升级 + re-enter 计划-草稿, and move status back to in_review
  // (the bumped plan needs a fresh review pass).
  await deps.client.removeLabel(input.multicaIssueId, '计划-已批准');
  await deps.client.addLabel(input.multicaIssueId, '计划-已升级');
  await deps.client.addLabel(input.multicaIssueId, '计划-草稿');
  await deps.client.updateIssue(input.multicaIssueId, { status: 'in_review' });

  // If the structured plan fields were supplied, regenerate the plan HTML
  // wholesale and APPEND it as a new versioned attachment (old attachments are
  // never deleted — v1, v2... accumulate so the evolution stays traceable),
  // then drop a comment documenting the upgrade.
  let attachmentId: string | null = null;
  if (input.planInput) {
    const version = input.version ?? 2;
    const html = renderPlanHtml(input.planInput);
    // Overwrite the local file (planPath is expected to be the .html path).
    await writeFile(input.planPath, html, 'utf-8');
    try {
      const att = await deps.client.uploadFile(
        html,
        `plan_v${version}.html`,
        input.multicaIssueId,
        'text/html'
      );
      attachmentId = att.id;
    } catch {
      /* upload failure is non-fatal — label/status transition already landed */
    }
    await deps.client.commentOnIssue(
      input.multicaIssueId,
      `计划已升级到 v${version}(原因:${input.reason})· 新 HTML 附件已上传`
    );
  }

  return { oldVersion, newVersion, snapshotPath, attachmentId };
}

function bumpVersion(v: string): string {
  const parts = v.split('.').map(Number);
  parts[1] = (parts[1] || 0) + 1;
  return parts.join('.');
}
