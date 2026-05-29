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
): Promise<{ reviewed: true; reviewedAt: string }> {
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

  await deps.client.addLabel(input.multicaIssueId, '复盘-已审');

  return { reviewed: true, reviewedAt };
}
