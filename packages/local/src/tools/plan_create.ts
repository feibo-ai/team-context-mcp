import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { MulticaClient } from '@tcmcp/shared';
import { renderPlanHtml } from '../render/plan-html.js';

export const planCreateInput = z.object({
  projectPath: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
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
    body: `Plan: \`${planPath}\``,
    labels: ['计划-草稿'],
  });

  let attachmentId: string | null = null;
  let uploadError: string | undefined;
  try {
    const att = await deps.client.uploadFile(
      html,
      `plan_${date}_${input.slug}_v1.html`,
      issue.id,
      'text/html'
    );
    attachmentId = att.id;
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
