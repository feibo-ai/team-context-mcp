// Test: notify_team({text} or {card}) calls feishu.msgSend* with config-resolved chatId
// 1. With text · uses msgSendText
// 2. With card · uses msgSendCard
// 3. Missing feishu_team_chat_id in config · throws clear error
import { describe, it, expect, vi, beforeEach } from 'vitest';

// NOTE: We do NOT vi.mock('@tcmcp/feishu') here — the tool only uses `type`
// imports of FeishuClient (erased at runtime), and the @tcmcp/feishu package
// has no built dist yet so Vite cannot resolve its entry. Instead we inject a
// duck-typed mock through the `deps.feishu` parameter. When the workspace
// rewires to source-level resolution (post-M-3 or via a tsconfig path map),
// the `vi.mock` line can be re-added without changing the rest of the suite.
import { notifyTeam } from '../../src/tools/notify_team.js';

type ConfigStub = {
  get: <T = unknown>(key: string) => T | undefined;
  getSecret: (key: string) => Promise<string | undefined>;
  version: () => number;
  onChange: (cb: (key: string) => void) => () => void;
};

function makeConfig(values: Record<string, unknown> = {}): ConfigStub {
  return {
    get: <T = unknown>(key: string) => values[key] as T | undefined,
    getSecret: async () => undefined,
    version: () => 1,
    onChange: () => () => {},
  };
}

function makeFeishu() {
  return {
    msgSendText: vi.fn(async (_p: { chatId: string; text: string }) => ({ messageId: 'msg-text-1' })),
    msgSendCard: vi.fn(async (_p: { chatId: string; card: object }) => ({ messageId: 'msg-card-1' })),
  };
}

describe('notifyTeam', () => {
  let config: ConfigStub;
  let feishu: ReturnType<typeof makeFeishu>;

  beforeEach(() => {
    feishu = makeFeishu();
  });

  it('routes text payload through msgSendText with config-resolved chatId', async () => {
    config = makeConfig({ feishu_team_chat_id: 'oc_chat_42' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await notifyTeam({ text: 'hello team' }, { config, feishu: feishu as any });
    expect(feishu.msgSendText).toHaveBeenCalledWith({ chatId: 'oc_chat_42', text: 'hello team' });
    expect(feishu.msgSendCard).not.toHaveBeenCalled();
    expect(res).toEqual({ messageId: 'msg-text-1' });
  });

  it('routes card payload through msgSendCard with config-resolved chatId', async () => {
    config = makeConfig({ feishu_team_chat_id: 'oc_chat_42' });
    const card = { config: { wide_screen_mode: true }, elements: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await notifyTeam({ card }, { config, feishu: feishu as any });
    expect(feishu.msgSendCard).toHaveBeenCalledWith({ chatId: 'oc_chat_42', card });
    expect(feishu.msgSendText).not.toHaveBeenCalled();
    expect(res).toEqual({ messageId: 'msg-card-1' });
  });

  it('throws a clear error when feishu_team_chat_id is not configured', async () => {
    config = makeConfig({});
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      notifyTeam({ text: 'hi' }, { config, feishu: feishu as any }),
    ).rejects.toThrow(/feishu_team_chat_id/);
    expect(feishu.msgSendText).not.toHaveBeenCalled();
    expect(feishu.msgSendCard).not.toHaveBeenCalled();
  });
});
