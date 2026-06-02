import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { MulticaClient } from '@tcmcp/shared';
import { renderPlanHtml } from '../render/plan-html.js';

export const planCreateInput = z.object({
  projectPath: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  // Required: every issue MUST live under a project. The agent picks it via
  // `multica project list` (the skill enforces: be certain · ask the user if unsure).
  projectId: z.string().min(1),
  layer: z.enum(['project', 'task']),
  dri: z.string().optional(),
  goal: z.string().min(10),
  completionCriteria: z.array(z.string().min(1)).min(1),
  appetite: z.string().optional(),
  exec: z.array(z.string()).optional(),
  collab: z.array(z.string()).optional(),
  reviewer: z.string().optional(),
  approach: z.string().optional(),
});

export type PlanCreateInput = z.infer<typeof planCreateInput>;

export interface PlanCreateDeps {
  client: MulticaClient;
}

export interface PlanCreateOutput {
  planPath: string;
  multicaIssueId: string;
  alreadyExisted: boolean;
  attachmentId: string | null;
  uploadError?: string;
}

export async function planCreate(
  raw: PlanCreateInput,
  deps: PlanCreateDeps
): Promise<PlanCreateOutput> {
  const input = planCreateInput.parse(raw);
  const date = new Date().toISOString().slice(0, 10);
  const planPath = join(
    input.projectPath,
    'docs',
    'plans',
    `plan_${date}_${input.slug}.html`
  );

  const html = renderPlanHtml(input);

  // Idempotency: if file exists, just return it
  let existed = false;
  try {
    await access(planPath);
    existed = true;
  } catch {
    await mkdir(dirname(planPath), { recursive: true });
    await writeFile(planPath, html, 'utf-8');
  }

  const issue = await deps.client.createIssue({
    title: `计划:${input.slug}`,
    body: `📄 计划文档以评论形式发布(见下方评论 · 最新版在底部)。本地副本:\`${planPath}\``,
    labels: ['计划-草稿'],
    projectId: input.projectId,
  });

  const filename = `plan_${date}_${input.slug}_v1.html`;
  let attachmentId: string | null = null;
  let uploadError: string | undefined;
  try {
    // Doc → COMMENT (append-only · renders inline via !file). NOT the issue
    // description: attachments are immutable (the CLI can't re-upload), so every
    // version is a new comment. See MulticaClient.publishDoc.
    const pub = await deps.client.publishDoc(issue.id, {
      html,
      filename,
      caption: '计划文档 v1(方案A · 下方渲染)',
    });
    attachmentId = pub.attachmentId;
  } catch (e) {
    uploadError = (e as Error).message;
  }

  return {
    planPath,
    multicaIssueId: issue.id,
    alreadyExisted: existed,
    attachmentId,
    uploadError,
  };
}
