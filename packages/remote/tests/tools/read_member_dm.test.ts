// packages/remote/tests/tools/read_member_dm.test.ts
//
// Plan 5 M-12 tests · `read_member_dm` is a thin wrapper around
// `feishu.msgHistoryP2P`. We stub the FeishuClient via vi.fn() rather than
// mock the lark SDK — the FeishuClient itself is unit-tested in
// packages/feishu/tests/client.test.ts.

import { describe, expect, it, vi } from 'vitest';
import { readMemberDm, readMemberDmInput } from '../../src/tools/read_member_dm.js';

function makeFeishuStub(returnValue: Array<{ content: string; sender: string }>) {
  return {
    msgHistoryP2P: vi.fn().mockResolvedValue(returnValue),
  };
}

describe('read_member_dm', () => {
  it('passes email + sinceISO + limit through to feishu.msgHistoryP2P', async () => {
    const feishu = makeFeishuStub([
      { content: 'q1: yes', sender: 'ou_alice' },
      { content: 'q2: no',  sender: 'ou_alice' },
    ]);

    const out = await readMemberDm(
      { email: 'alice@x', sinceISO: '2026-05-01', limit: 25 },
      { feishu: feishu as never },
    );

    expect(feishu.msgHistoryP2P).toHaveBeenCalledTimes(1);
    expect(feishu.msgHistoryP2P).toHaveBeenCalledWith({
      email: 'alice@x',
      sinceISO: '2026-05-01',
      limit: 25,
    });
    expect(out).toEqual({
      messages: [
        { content: 'q1: yes', sender: 'ou_alice' },
        { content: 'q2: no',  sender: 'ou_alice' },
      ],
    });
  });

  it('omits limit when caller did not supply one (defers to FeishuClient default)', async () => {
    const feishu = makeFeishuStub([]);

    await readMemberDm(
      { email: 'bob@x', sinceISO: '2026-05-01T00:00:00Z' },
      { feishu: feishu as never },
    );

    expect(feishu.msgHistoryP2P).toHaveBeenCalledWith({
      email: 'bob@x',
      sinceISO: '2026-05-01T00:00:00Z',
      limit: undefined,
    });
  });

  it('returns empty list when feishu has no matching messages', async () => {
    const feishu = makeFeishuStub([]);
    const out = await readMemberDm(
      { email: 'noone@x', sinceISO: '2026-05-01' },
      { feishu: feishu as never },
    );
    expect(out).toEqual({ messages: [] });
  });

  it('rejects invalid email shape (no @)', () => {
    expect(() => readMemberDmInput.parse({ email: 'invalid', sinceISO: '2026-05-01' })).toThrow();
  });

  it('rejects non-positive limit', () => {
    expect(() => readMemberDmInput.parse({ email: 'a@x', sinceISO: '2026-05-01', limit: 0 })).toThrow();
    expect(() => readMemberDmInput.parse({ email: 'a@x', sinceISO: '2026-05-01', limit: -1 })).toThrow();
  });

  it('rejects limit above the 200 cap', () => {
    expect(() => readMemberDmInput.parse({ email: 'a@x', sinceISO: '2026-05-01', limit: 201 })).toThrow();
  });
});
