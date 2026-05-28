// packages/remote/src/tools/notify_team.ts
//
// Tool: notify_team — sends a text or interactive card to the team chat.
// chatId is resolved from config key `feishu_team_chat_id` (set via multica
// integration config). Card path uses Feishu interactive-card JSON.
//
// TODO(M-3+): when `@tcmcp/config` and `@tcmcp/feishu` publish a built `dist/`
// (or the workspace tsconfig is rewired to resolve to source), swap the local
// placeholder types below for:
//   import type { ConfigSource } from '@tcmcp/config';
//   import type { FeishuClient } from '@tcmcp/feishu';
// The placeholder shapes intentionally mirror the source types so the swap is
// a single import-line change.
import { z } from 'zod';

// --- Local placeholder types (see TODO above) ---
interface ConfigSource {
  get<T = unknown>(key: string): T | undefined;
  getSecret(key: string): Promise<string | undefined>;
  version(): number;
  onChange(callback: (changedKey: string) => void): () => void;
  start?(): Promise<void>;
  stop?(): Promise<void>;
}

interface FeishuClient {
  msgSendText(p: { chatId: string; text: string }): Promise<{ messageId: string }>;
  msgSendCard(p: { chatId: string; card: object }): Promise<{ messageId: string }>;
}
// --- end placeholders ---

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
