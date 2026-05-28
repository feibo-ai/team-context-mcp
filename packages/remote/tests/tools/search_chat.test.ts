import { describe, it, expect, vi, beforeEach } from 'vitest';

const searchChats = vi.fn();

vi.mock('@tcmcp/feishu', () => ({
  FeishuClient: class {
    searchChats = searchChats;
  },
}));

import { FeishuClient } from '@tcmcp/feishu';
import { searchChat } from '../../src/tools/search_chat.js';

describe('search_chat', () => {
  let feishu: FeishuClient;

  beforeEach(() => {
    searchChats.mockReset();
    feishu = new (FeishuClient as unknown as new () => FeishuClient)();
  });

  it('wraps feishu.searchChats · returns list of chatId+name', async () => {
    searchChats.mockResolvedValue([
      { chatId: 'oc_team_a', name: 'Team A' },
      { chatId: 'oc_team_b', name: 'Team B' },
    ]);

    const res = await searchChat({ query: 'Team' }, { feishu });

    expect(searchChats).toHaveBeenCalledWith({ query: 'Team' });
    expect(res).toEqual({
      chats: [
        { chatId: 'oc_team_a', name: 'Team A' },
        { chatId: 'oc_team_b', name: 'Team B' },
      ],
    });
  });

  it('returns empty list when feishu finds no chats', async () => {
    searchChats.mockResolvedValue([]);

    const res = await searchChat({ query: 'no-such-chat' }, { feishu });

    expect(searchChats).toHaveBeenCalledWith({ query: 'no-such-chat' });
    expect(res).toEqual({ chats: [] });
  });

  it('rejects empty query at schema layer', async () => {
    await expect(searchChat({ query: '' }, { feishu })).rejects.toThrow();
    expect(searchChats).not.toHaveBeenCalled();
  });
});
