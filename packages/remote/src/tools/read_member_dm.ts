// packages/remote/src/tools/read_member_dm.ts
//
// Plan 5 M-12 · thin wrapper over `feishu.msgHistoryP2P`. Reads recent P2P
// chat history for one team member; used by `burnout_check_distribute`
// collect phase to auto-scrape replies.
//
// Returns raw messages with sender info. Anonymization (drop sender) is the
// caller's responsibility — keep the wrapper transport-faithful.

import { z } from 'zod';
import type { FeishuClient } from '@tcmcp/feishu';

export const readMemberDmInput = z.object({
  // Internal teams use compact addresses (alice@x). Accept email-shape, not RFC strict.
  email: z.string().regex(/^.+@.+$/),
  // ISO-8601 lower bound (e.g. '2026-05-01' or '2026-05-01T00:00:00Z'); inclusive.
  sinceISO: z.string().min(1),
  // Page size cap. FeishuClient defaults to 50; mirror that here.
  limit: z.number().int().positive().max(200).optional(),
});

export async function readMemberDm(
  raw: z.infer<typeof readMemberDmInput>,
  deps: { feishu: FeishuClient },
): Promise<{ messages: Array<{ content: string; sender: string }> }> {
  const input = readMemberDmInput.parse(raw);
  const messages = await deps.feishu.msgHistoryP2P({
    email: input.email,
    sinceISO: input.sinceISO,
    limit: input.limit,
  });
  return { messages };
}
