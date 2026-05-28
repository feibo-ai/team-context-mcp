import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { MulticaClient } from '../lib/multica.js';
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

  await deps.client.addLabel(input.multicaIssueId, 'plan-approved');

  const original = await readFile(input.planPath, 'utf-8');
  const reviewedAt = new Date().toISOString();
  const newBody = [
    `- Reviewer: ${input.reviewer}`,
    `- Reviewed: ${reviewedAt}`,
    `- Verdict: approved`,
  ].join('\n');
  const updated = replaceSection(original, 'Review', newBody);
  await writeFile(input.planPath, updated, 'utf-8');

  return { approvedAt: reviewedAt };
}
