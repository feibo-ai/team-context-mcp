import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { MulticaClient } from '@tcmcp/shared';
import { findSection, upsertSection } from '@tcmcp/shared';

export const caseReviewInput = z.object({
  casePath: z.string(),
  multicaIssueId: z.string(),
  // Tests use compact non-RFC-strict emails (a@b, dri@aimiq) so we just require
  // a recognizable email shape rather than full RFC 5321 validation.
  reviewerEmail: z.string().min(3).regex(/^.+@.+$/, 'expected an email-like value'),
});

const MIN_SECTION_4_CHARS = 100;

export async function caseReview(
  raw: z.infer<typeof caseReviewInput>,
  deps: { client: MulticaClient }
): Promise<{ reviewed: true; reviewedAt: string; closedPlanIssueId?: string }> {
  const input = caseReviewInput.parse(raw);
  const text = await readFile(input.casePath, 'utf-8');

  const section4 = findSection(text, '4. 关键判断');
  if (!section4 || section4.length < MIN_SECTION_4_CHARS) {
    throw new Error(
      `section 4 "关键判断" too short (${section4?.length ?? 0} chars < ${MIN_SECTION_4_CHARS}). SOP Section 4 requires substantive analysis — not a placeholder.`
    );
  }

  const reviewedAt = new Date().toISOString();
  // Test regex uses `Reviewed by:\s*<email>` — don't bold-wrap (would produce `:**` not `:` + space).
  const reviewBlock = `${section4}\n\n---\nReviewed by: ${input.reviewerEmail}\nReviewed at: ${reviewedAt}`;
  const updated = upsertSection(text, '4. 关键判断', reviewBlock);
  await writeFile(input.casePath, updated, 'utf-8');

  // State-machine transition: reviewed → drop 复盘-待审 (mutually exclusive) and
  // mark the case issue done.
  await deps.client.addLabel(input.multicaIssueId, '复盘-已审');
  await deps.client.removeLabel(input.multicaIssueId, '复盘-待审');
  await deps.client.updateIssue(input.multicaIssueId, { status: 'done' });

  // §6 (DRI = auto): a reviewed case closes the whole thread, so also mark the
  // linked plan issue done. The link is the case issue's parent_issue_id (set by
  // case_create). No parent → nothing to close.
  const caseIssue = (await deps.client.getIssue(input.multicaIssueId)) as unknown as Record<
    string,
    unknown
  >;
  const closedPlanIssueId =
    (caseIssue.parent_issue_id as string | null | undefined) ?? undefined;
  if (closedPlanIssueId) {
    await deps.client.updateIssue(closedPlanIssueId, { status: 'done' });
  }

  return { reviewed: true, reviewedAt, closedPlanIssueId };
}
