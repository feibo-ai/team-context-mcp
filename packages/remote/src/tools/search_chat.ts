// search_chat.ts — Plan 5 Task M-13
//
// Thin wrapper around `feishu.searchChats` so a DRI can resolve a chat_id by
// query string. Maintenance helper, not part of the regular SOP flow — used
// when configuring `feishu_team_chat_id` or wiring up a new project channel.

import { z } from 'zod';
import type { FeishuClient } from '@tcmcp/feishu';

export const searchChatInput = z.object({
  query: z.string().min(1),
});

export async function searchChat(
  raw: z.infer<typeof searchChatInput>,
  deps: { feishu: FeishuClient },
): Promise<{ chats: Array<{ chatId: string; name: string }> }> {
  const input = searchChatInput.parse(raw);
  const chats = await deps.feishu.searchChats({ query: input.query });
  return { chats };
}
