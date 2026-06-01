import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { MulticaClient } from '@tcmcp/shared';
import { fileEmbed } from '@tcmcp/shared';
import { renderCaseHtml } from '../render/case-html.js';

export const caseCreateInput = z.object({
  projectPath: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  goal: z.string().min(1),
  whatHappened: z.string().min(1).max(1500), // ~200 words
  criteriaResults: z.array(z.object({
    criterion: z.string(),
    met: z.boolean(),
    notMetReason: z.string().optional(),
  })),
  keyJudgments: z.array(z.object({
    title: z.string(),
    context: z.string(),
    options: z.array(z.string()),
    chose: z.string(),
    inHindsight: z.string(),
    ancientImpossible: z.string(),
  })).min(1),
  ruleCandidates: z.array(z.string()).max(3).default([]),
  multicaProjectId: z.string().optional(),
  // Original plan issue id — when present, the case issue is linked to it via
  // parent_issue_id so case_review can traverse up and auto-close the plan.
  planIssueId: z.string().optional(),
});

export type CaseCreateInput = z.infer<typeof caseCreateInput>;

export interface CaseCreateOutput {
  casePath: string;
  multicaIssueId: string;
  attachmentId: string | null;
  uploadError?: string;
}

export async function caseCreate(
  raw: CaseCreateInput,
  deps: { client: MulticaClient }
): Promise<CaseCreateOutput> {
  const input = caseCreateInput.parse(raw);
  const date = new Date().toISOString().slice(0, 10);
  const casePath = join(input.projectPath, 'cases', `${date}-${input.slug}.html`);

  try {
    await access(casePath);
    throw new Error(`case already exists: ${casePath}`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      // re-throw if our "already exists" check OR another error
      if (String(e).includes('already exists')) throw e;
    }
  }

  await mkdir(dirname(casePath), { recursive: true });
  const html = renderCaseHtml(input);
  await writeFile(casePath, html, 'utf-8');

  const issue = await deps.client.createIssue({
    title: `复盘:${input.slug}`,
    body: `Case file: \`${casePath}\``,
    labels: ['复盘-待审'],
    projectId: input.multicaProjectId,
  });

  // 修D · structured link back to the plan issue. createIssue has no parent
  // param, so set parent_issue_id via updateIssue — this is what lets
  // case_review traverse up and auto-close the plan when the case is approved.
  if (input.planIssueId) {
    await deps.client.updateIssue(issue.id, { parentIssueId: input.planIssueId });
  }

  // Upload the rendered HTML as an attachment on the issue so it renders in
  // multica. Upload failure must NOT throw — the local case file + issue are
  // already the source of truth.
  let attachmentId: string | null = null;
  let uploadError: string | undefined;
  const filename = `case_${date}_${input.slug}_v1.html`;
  try {
    const att = await deps.client.uploadFile(html, filename, issue.id, 'text/html');
    attachmentId = att.id;
    // Embed the doc in the issue description so it renders inline in the issue
    // body (issue-level binding alone has no render surface — see fileEmbed).
    if (att.url) {
      await deps.client.updateIssue(issue.id, {
        description: `案例文档(方案A · 下方渲染):\n\n${fileEmbed(filename, att.url)}`,
        attachmentIds: [att.id],
      });
    }
  } catch (e) {
    uploadError = (e as Error).message;
  }

  return { casePath, multicaIssueId: issue.id, attachmentId, uploadError };
}
