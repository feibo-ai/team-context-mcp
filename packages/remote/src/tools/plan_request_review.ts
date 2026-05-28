import { z } from 'zod';
import type { MulticaClient } from '@tcmcp/shared';

export const planRequestReviewInput = z.object({
  multicaIssueId: z.string(),
  reviewer: z.string(),
});

export type PlanRequestReviewInput = z.infer<typeof planRequestReviewInput>;

export async function planRequestReview(
  raw: PlanRequestReviewInput,
  deps: { client: MulticaClient }
): Promise<{ commentId: string }> {
  const input = planRequestReviewInput.parse(raw);

  await deps.client.addLabel(input.multicaIssueId, 'plan-under-review');

  const comment = await deps.client.commentOnIssue(
    input.multicaIssueId,
    [
      `Review requested from **${input.reviewer}**.`,
      '',
      'Per SOP v0.4 P-3, please review with **staff engineer** mindset:',
      '- Goal: is it specific and verifiable?',
      '- Completion criteria: are they observable signals?',
      '- Scope: is anything missing or over-scoped?',
      '- Risks: anything that could blow up?',
      '',
      'Reply with verdict: `approved` / `changes-requested: <reason>`.',
    ].join('\n')
  );

  return { commentId: comment.id };
}
