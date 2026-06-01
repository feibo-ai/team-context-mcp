import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { MulticaClient } from '@tcmcp/shared';
import { replaceSection } from '@tcmcp/shared';

export const planApproveInput = z.object({
  multicaIssueId: z.string(),
  planPath: z.string(),
  reviewer: z.string(),
});

export type PlanApproveInput = z.infer<typeof planApproveInput>;

export async function planApprove(
  raw: PlanApproveInput,
  deps: { client: MulticaClient }
): Promise<{ approvedAt: string }> {
  const input = planApproveInput.parse(raw);

  // State-machine transition: approved → clear the mutually-exclusive draft /
  // under-review labels and move status to in_progress (entering Implement).
  await deps.client.addLabel(input.multicaIssueId, '计划-已批准');
  await deps.client.removeLabel(input.multicaIssueId, '计划-草稿');
  await deps.client.removeLabel(input.multicaIssueId, '计划-评审中');
  await deps.client.updateIssue(input.multicaIssueId, { status: 'in_progress' });

  const original = await readFile(input.planPath, 'utf-8');
  const reviewedAt = new Date().toISOString();
  const newBody = [
    `- Reviewer: ${input.reviewer}`,
    `- Reviewed: ${reviewedAt}`,
    `- Verdict: approved`,
  ].join('\n');
  const updated = replaceSection(original, '评审', newBody);
  await writeFile(input.planPath, updated, 'utf-8');

  return { approvedAt: reviewedAt };
}
