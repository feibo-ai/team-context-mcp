// packages/remote/src/tools/notify_team.ts
//
// Tool: notify_team — sends a text or interactive card to the team chat.
// chatId is resolved from config key `feishu_team_chat_id` (set via multica
// integration config). Card path uses Feishu interactive-card JSON.
import { z } from 'zod';
import type { ConfigSource } from '@tcmcp/config';
import type { FeishuClient } from '@tcmcp/feishu';

export const notifyTeamInput = z.union([
  z.object({ text: z.string().min(1) }),
  z.object({ card: z.record(z.unknown()) }),
]);

export async function notifyTeam(
  raw: z.infer<typeof notifyTeamInput>,
  deps: { config: ConfigSource; feishu: FeishuClient },
): Promise<{ messageId: string }> {
  const chatId = deps.config.get<string>('feishu_team_chat_id');
  if (!chatId) throw new Error('feishu_team_chat_id not configured (multica integration config)');
  if ('text' in raw) return deps.feishu.msgSendText({ chatId, text: raw.text });
  return deps.feishu.msgSendCard({ chatId, card: raw.card });
}
