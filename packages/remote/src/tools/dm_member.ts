// packages/remote/src/tools/dm_member.ts
//
// Tool: dm_member — sends a P2P direct message to a member by email.
// Requires at least one of `text` or `card`. Backed by FeishuClient.dmSendByEmail.
//
// TODO(M-3+): swap local placeholder for `import type { FeishuClient } from
// '@tcmcp/feishu';` once that package ships a built dist (see notify_team.ts
// for the same TODO).
import { z } from 'zod';

// --- Local placeholder type (see TODO above) ---
interface FeishuClient {
  dmSendByEmail(p: {
    email: string;
    text?: string;
    card?: object;
  }): Promise<{ messageId: string }>;
}
// --- end placeholder ---

export const dmMemberInput = z
  .object({
    email: z.string().email(),
    text: z.string().optional(),
    card: z.record(z.unknown()).optional(),
  })
  .refine((v) => v.text || v.card, { message: 'text or card required' });

export async function dmMember(
  raw: unknown,
  deps: { feishu: FeishuClient },
): Promise<{ messageId: string }> {
  const input = dmMemberInput.parse(raw);
  return deps.feishu.dmSendByEmail(input);
}
