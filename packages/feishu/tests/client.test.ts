// packages/feishu/tests/client.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigSource } from '../src/client.js';

// ---- Mock lark SDK ----
// Each constructed `lark.Client` proxies through a shared mock object so tests
// can inspect calls. We track instance count via `clientCtor`.
const clientCtor = vi.fn();
const mockSdk = {
  im: {
    message: {
      create: vi.fn(),
      list: vi.fn(),
    },
    chat: {
      search: vi.fn(),
    },
  },
  contact: {
    user: {
      batchGetId: vi.fn(),
    },
  },
  wiki: {
    spaceNode: {
      create: vi.fn(),
    },
  },
};

vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: vi.fn().mockImplementation((opts) => {
    clientCtor(opts);
    return mockSdk;
  }),
}));

// Import after mock is registered.
import { FeishuClient } from '../src/client.js';

// ---- Test ConfigSource factory ----
function makeConfig(initial: {
  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
}): ConfigSource & {
  setSecret: (k: string, v: string | undefined) => void;
  fireChange: (k: string) => void;
  listeners: Array<(k: string) => void>;
} {
  const secrets: Record<string, string | undefined> = { ...initial };
  const listeners: Array<(k: string) => void> = [];
  return {
    get: () => undefined,
    getSecret: async (k: string) => secrets[k],
    version: () => 1,
    onChange: (cb) => {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    setSecret: (k, v) => {
      secrets[k] = v;
    },
    fireChange: (k) => {
      for (const cb of listeners) cb(k);
    },
    listeners,
  };
}

describe('FeishuClient', () => {
  beforeEach(() => {
    clientCtor.mockClear();
    mockSdk.im.message.create.mockReset();
    mockSdk.im.message.list.mockReset();
    mockSdk.im.chat.search.mockReset();
    mockSdk.contact.user.batchGetId.mockReset();
    mockSdk.wiki.spaceNode.create.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('Constructor takes ConfigSource and subscribes to onChange', () => {
    const cfg = makeConfig({ FEISHU_APP_ID: 'a', FEISHU_APP_SECRET: 's' });
    const before = cfg.listeners.length;
    new FeishuClient(cfg);
    expect(cfg.listeners.length).toBe(before + 1);
  });

  it('msgSendText returns message_id', async () => {
    const cfg = makeConfig({ FEISHU_APP_ID: 'a', FEISHU_APP_SECRET: 's' });
    const c = new FeishuClient(cfg);
    mockSdk.im.message.create.mockResolvedValueOnce({ data: { message_id: 'om_abc' } });

    const out = await c.msgSendText({ chatId: 'oc_x', text: 'hello' });

    expect(out).toEqual({ messageId: 'om_abc' });
    expect(mockSdk.im.message.create).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: 'oc_x', msg_type: 'text', content: JSON.stringify({ text: 'hello' }) },
    });
  });

  it('msgSendCard returns message_id', async () => {
    const cfg = makeConfig({ FEISHU_APP_ID: 'a', FEISHU_APP_SECRET: 's' });
    const c = new FeishuClient(cfg);
    mockSdk.im.message.create.mockResolvedValueOnce({ data: { message_id: 'om_card' } });
    const card = { config: { wide_screen_mode: true }, elements: [] };

    const out = await c.msgSendCard({ chatId: 'oc_x', card });

    expect(out).toEqual({ messageId: 'om_card' });
    expect(mockSdk.im.message.create).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: 'oc_x', msg_type: 'interactive', content: JSON.stringify(card) },
    });
  });

  it('dmSendByEmail sends text when card is absent', async () => {
    const cfg = makeConfig({ FEISHU_APP_ID: 'a', FEISHU_APP_SECRET: 's' });
    const c = new FeishuClient(cfg);
    mockSdk.im.message.create.mockResolvedValueOnce({ data: { message_id: 'om_dm' } });

    const out = await c.dmSendByEmail({ email: 'u@x.com', text: 'hi' });

    expect(out).toEqual({ messageId: 'om_dm' });
    expect(mockSdk.im.message.create).toHaveBeenCalledWith({
      params: { receive_id_type: 'email' },
      data: { receive_id: 'u@x.com', msg_type: 'text', content: JSON.stringify({ text: 'hi' }) },
    });
  });

  it('dmSendByEmail sends card when card is present', async () => {
    const cfg = makeConfig({ FEISHU_APP_ID: 'a', FEISHU_APP_SECRET: 's' });
    const c = new FeishuClient(cfg);
    mockSdk.im.message.create.mockResolvedValueOnce({ data: { message_id: 'om_dm2' } });
    const card = { elements: [{ tag: 'div', text: { content: 'x', tag: 'plain_text' } }] };

    const out = await c.dmSendByEmail({ email: 'u@x.com', card });

    expect(out).toEqual({ messageId: 'om_dm2' });
    expect(mockSdk.im.message.create).toHaveBeenCalledWith({
      params: { receive_id_type: 'email' },
      data: { receive_id: 'u@x.com', msg_type: 'interactive', content: JSON.stringify(card) },
    });
  });

  it('throws when FEISHU_APP_ID is missing', async () => {
    const cfg = makeConfig({ FEISHU_APP_SECRET: 's' });
    const c = new FeishuClient(cfg);
    await expect(c.msgSendText({ chatId: 'x', text: 'y' })).rejects.toThrow(
      /FEISHU_APP_ID \+ FEISHU_APP_SECRET required/,
    );
  });

  it('throws when FEISHU_APP_SECRET is missing', async () => {
    const cfg = makeConfig({ FEISHU_APP_ID: 'a' });
    const c = new FeishuClient(cfg);
    await expect(c.msgSendText({ chatId: 'x', text: 'y' })).rejects.toThrow(
      /FEISHU_APP_ID \+ FEISHU_APP_SECRET required/,
    );
  });

  it('reuses the lark Client across calls when secrets unchanged', async () => {
    const cfg = makeConfig({ FEISHU_APP_ID: 'a', FEISHU_APP_SECRET: 's' });
    const c = new FeishuClient(cfg);
    mockSdk.im.message.create.mockResolvedValue({ data: { message_id: 'om' } });

    await c.msgSendText({ chatId: 'oc_x', text: '1' });
    await c.msgSendText({ chatId: 'oc_x', text: '2' });

    expect(clientCtor).toHaveBeenCalledTimes(1);
  });

  it('invalidates cached SDK on onChange for FEISHU_APP_SECRET', async () => {
    const cfg = makeConfig({ FEISHU_APP_ID: 'a', FEISHU_APP_SECRET: 's1' });
    const c = new FeishuClient(cfg);
    mockSdk.im.message.create.mockResolvedValue({ data: { message_id: 'om' } });

    await c.msgSendText({ chatId: 'oc_x', text: '1' });
    expect(clientCtor).toHaveBeenCalledTimes(1);

    // Rotate the secret and fire the change event.
    cfg.setSecret('FEISHU_APP_SECRET', 's2');
    cfg.fireChange('FEISHU_APP_SECRET');

    await c.msgSendText({ chatId: 'oc_x', text: '2' });
    expect(clientCtor).toHaveBeenCalledTimes(2);
    // Second instantiation uses the new secret.
    expect(clientCtor).toHaveBeenLastCalledWith({
      appId: 'a',
      appSecret: 's2',
      disableTokenCache: false,
    });
  });

  it('also invalidates on wildcard onChange', async () => {
    const cfg = makeConfig({ FEISHU_APP_ID: 'a', FEISHU_APP_SECRET: 's1' });
    const c = new FeishuClient(cfg);
    mockSdk.im.message.create.mockResolvedValue({ data: { message_id: 'om' } });

    await c.msgSendText({ chatId: 'oc_x', text: '1' });
    cfg.setSecret('FEISHU_APP_SECRET', 's2');
    cfg.fireChange('*');
    await c.msgSendText({ chatId: 'oc_x', text: '2' });

    expect(clientCtor).toHaveBeenCalledTimes(2);
  });

  it('searchChats returns mapped {chatId, name} array', async () => {
    const cfg = makeConfig({ FEISHU_APP_ID: 'a', FEISHU_APP_SECRET: 's' });
    const c = new FeishuClient(cfg);
    mockSdk.im.chat.search.mockResolvedValueOnce({
      data: {
        items: [
          { chat_id: 'oc_1', name: 'Alpha' },
          { chat_id: 'oc_2', name: 'Beta' },
        ],
      },
    });

    const out = await c.searchChats({ query: 'team' });

    expect(out).toEqual([
      { chatId: 'oc_1', name: 'Alpha' },
      { chatId: 'oc_2', name: 'Beta' },
    ]);
    expect(mockSdk.im.chat.search).toHaveBeenCalledWith({
      params: { query: 'team', page_size: 20 },
    });
  });

  it('searchChats returns [] when SDK omits items', async () => {
    const cfg = makeConfig({ FEISHU_APP_ID: 'a', FEISHU_APP_SECRET: 's' });
    const c = new FeishuClient(cfg);
    mockSdk.im.chat.search.mockResolvedValueOnce({ data: {} });

    const out = await c.searchChats({ query: 'team' });
    expect(out).toEqual([]);
  });
});
