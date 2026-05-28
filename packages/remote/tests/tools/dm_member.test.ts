// Test: dm_member({email, text?, card?}) calls feishu.dmSendByEmail.
// 1. With text · forwarded to dmSendByEmail
// 2. With card · forwarded to dmSendByEmail
// 3. Neither text nor card · zod refine rejects with clear message
// 4. Invalid email · zod email() rejects
import { describe, it, expect, vi, beforeEach } from 'vitest';

// NOTE: We do NOT vi.mock('@tcmcp/feishu') — the tool only `type`-imports
// FeishuClient (erased at runtime), and the @tcmcp/feishu package has no
// built dist yet so Vite cannot resolve its entry. We inject a duck-typed
// mock through `deps.feishu` instead. See notify_team.test.ts for the longer
// note.
import { dmMember } from '../../src/tools/dm_member.js';

function makeFeishu() {
  return {
    dmSendByEmail: vi.fn(
      async (_p: { email: string; text?: string; card?: object }) => ({ messageId: 'msg-dm-1' }),
    ),
  };
}

describe('dmMember', () => {
  let feishu: ReturnType<typeof makeFeishu>;

  beforeEach(() => {
    feishu = makeFeishu();
  });

  it('forwards text DM to dmSendByEmail', async () => {
    const res = await dmMember(
      { email: 'alice@example.com', text: 'ping' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { feishu: feishu as any },
    );
    expect(feishu.dmSendByEmail).toHaveBeenCalledWith({
      email: 'alice@example.com',
      text: 'ping',
    });
    expect(res).toEqual({ messageId: 'msg-dm-1' });
  });

  it('forwards card DM to dmSendByEmail', async () => {
    const card = { config: {}, elements: [] };
    await dmMember(
      { email: 'bob@example.com', card },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { feishu: feishu as any },
    );
    expect(feishu.dmSendByEmail).toHaveBeenCalledWith({
      email: 'bob@example.com',
      card,
    });
  });

  it('rejects when neither text nor card is provided', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dmMember({ email: 'alice@example.com' } as any, { feishu: feishu as any }),
    ).rejects.toThrow(/text or card required/);
    expect(feishu.dmSendByEmail).not.toHaveBeenCalled();
  });

  it('rejects invalid email', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dmMember({ email: 'not-an-email', text: 'x' }, { feishu: feishu as any }),
    ).rejects.toThrow();
    expect(feishu.dmSendByEmail).not.toHaveBeenCalled();
  });
});
