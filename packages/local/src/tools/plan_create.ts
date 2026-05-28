import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { MulticaClient } from '@tcmcp/shared';

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
    `plan_${date}_${input.slug}.md`
  );

  // Idempotency: if file exists, just return it
  let existed = false;
  try {
    await access(planPath);
    existed = true;
  } catch {
    await mkdir(dirname(planPath), { recursive: true });
    const body = renderPlanMarkdown(input, date);
    await writeFile(planPath, body, 'utf-8');
  }

  const issue = await deps.client.createIssue({
    title: `Plan: ${input.slug}`,
    body: `Plan markdown: \`${planPath}\``,
    labels: ['plan-draft'],
  });

  return { planPath, multicaIssueId: issue.id, alreadyExisted: existed };
}

function renderPlanMarkdown(input: PlanCreateInput, date: string): string {
  if (input.layer === 'task') {
    return `# Plan: ${input.slug}

**Created:** ${date}
**Layer:** task

**What:** ${input.goal}
**Done when:** ${input.completionCriteria.join('; ')}
**Boundary:** (out of scope: TBD)
`;
  }

  const criteria = input.completionCriteria.map((c) => `- [ ] ${c}`).join('\n');
  const exec = (input.exec || []).join(', ') || '_(unassigned)_';
  const collab = (input.collab || []).join(', ') || '_(none)_';
  const reviewer = input.reviewer || '_(assign before Implement phase)_';
  const approach = input.approach || '_(fill in)_';

  return `# Plan: ${input.slug}

**Created:** ${date}
**DRI:** ${input.dri || '_(assign)_'}
**Layer:** project

## Goal
${input.goal}

## Completion criteria
${criteria}

## How to split
- DRI: ${input.dri || '_(assign)_'}
- EXEC: ${exec}
- COLLAB: ${collab}
- REVIEW: ${reviewer}

## Appetite
${input.appetite || '_(set)_'}

## Approach
${approach}

## Review
- Reviewer: _(pending)_
- Reviewed: _(pending)_
- Verdict: pending

## Current State (handoff slot — see pre-clear skill)
_(empty until first handoff)_
`;
}
