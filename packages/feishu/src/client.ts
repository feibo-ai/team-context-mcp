// packages/feishu/src/client.ts
import * as lark from '@larksuiteoapi/node-sdk';

// NOTE: Local placeholder for `ConfigSource` (mirrors @tcmcp/config/src/source.ts).
// `@tcmcp/config` resolves to `dist/index.d.ts` via its exports map, which is not
// built in this monorepo yet (no dist). Swap this to `import type { ConfigSource }
// from '@tcmcp/config';` once M-3+ produces a dist or the workspace tsconfig is
// rewired to resolve to source.
export interface ConfigSource {
  /** Get a non-secret config value. Returns undefined if not set. */
  get<T = unknown>(key: string): T | undefined;
  /** Get a secret value. Async because may hit network. Cached internally. */
  getSecret(key: string): Promise<string | undefined>;
  /** Get current config version (for sanity check). */
  version(): number;
  /** Subscribe to config changes. Returns unsubscribe fn. */
  onChange(callback: (changedKey: string) => void): () => void;
  /** Start any background work (poll/WS). */
  start?(): Promise<void>;
  /** Cleanup. */
  stop?(): Promise<void>;
}

export class FeishuClient {
  private sdk?: lark.Client;
  private lastAppId?: string;
  private lastAppSecret?: string;

  constructor(private config: ConfigSource) {
    config.onChange((key) => {
      if (key === '*' || key === 'FEISHU_APP_ID' || key === 'FEISHU_APP_SECRET') {
        this.sdk = undefined; // lazy rebuild on next call
      }
    });
  }

  private async ensureSdk(): Promise<lark.Client> {
    const appId = await this.config.getSecret('FEISHU_APP_ID');
    const appSecret = await this.config.getSecret('FEISHU_APP_SECRET');
    if (!appId || !appSecret) {
      throw new Error('FEISHU_APP_ID + FEISHU_APP_SECRET required (set via multica secret or env)');
    }
    if (this.sdk && appId === this.lastAppId && appSecret === this.lastAppSecret) {
      return this.sdk;
    }
    this.sdk = new lark.Client({ appId, appSecret, disableTokenCache: false });
    this.lastAppId = appId;
    this.lastAppSecret = appSecret;
    return this.sdk;
  }

  /**
   * Lightweight reachability + auth probe. Returns true iff:
   *   1. FEISHU_APP_ID + FEISHU_APP_SECRET secrets are present in config
   *   2. lark SDK token endpoint accepts the credentials (auth.v3.tenantAccessToken.internal)
   * Used by /health (M-17) to surface `feishu_ready` — distinguishes
   * "creds missing" from "feishu API down" from "creds wrong".
   */
  async ping(): Promise<boolean> {
    try {
      const sdk = await this.ensureSdk();
      // The auth.v3.tenantAccessToken.internal endpoint is the cheapest probe
      // and is what every other call hits internally for token rotation.
      const res = await sdk.auth.tenantAccessToken.internal({
        data: { app_id: this.lastAppId!, app_secret: this.lastAppSecret! },
      });
      return res.code === 0;
    } catch {
      return false;
    }
  }

  async msgSendText(p: { chatId: string; text: string }): Promise<{ messageId: string }> {
    const sdk = await this.ensureSdk();
    const res = await sdk.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: p.chatId, msg_type: 'text', content: JSON.stringify({ text: p.text }) },
    });
    return { messageId: res.data?.message_id ?? '' };
  }

  async msgSendCard(p: { chatId: string; card: object }): Promise<{ messageId: string }> {
    const sdk = await this.ensureSdk();
    const res = await sdk.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: p.chatId, msg_type: 'interactive', content: JSON.stringify(p.card) },
    });
    return { messageId: res.data?.message_id ?? '' };
  }

  async dmSendByEmail(p: { email: string; text?: string; card?: object }): Promise<{ messageId: string }> {
    const sdk = await this.ensureSdk();
    const data = p.card
      ? { receive_id: p.email, msg_type: 'interactive', content: JSON.stringify(p.card) }
      : { receive_id: p.email, msg_type: 'text', content: JSON.stringify({ text: p.text ?? '' }) };
    const res = await sdk.im.message.create({ params: { receive_id_type: 'email' }, data });
    return { messageId: res.data?.message_id ?? '' };
  }

  async msgHistoryP2P(p: { email: string; sinceISO: string; limit?: number }): Promise<Array<{ content: string; sender: string }>> {
    const sdk = await this.ensureSdk();
    // 1. Resolve email -> open_id via contact API
    const user = await sdk.contact.user.batchGetId({
      params: { user_id_type: 'open_id' },
      data: { emails: [p.email] },
    });
    const openId = user.data?.user_list?.[0]?.user_id;
    if (!openId) return [];
    // 2. Find p2p chat by query (real method is `im.chat.search`, NOT `im.chat.list`).
    //    `list` enumerates chats the bot is in; `search` queries by name/open_id.
    const chat = await sdk.im.chat.search({ params: { query: openId, page_size: 1 } });
    const chatId = chat.data?.items?.[0]?.chat_id;
    if (!chatId) return [];
    // 3. Get messages. `container_id_type` is "chat" | "thread".
    const since = Math.floor(new Date(p.sinceISO).getTime() / 1000);
    const msgs = await sdk.im.message.list({
      params: {
        container_id_type: 'chat',
        container_id: chatId,
        start_time: String(since),
        page_size: p.limit ?? 50,
      },
    });
    return (msgs.data?.items ?? []).map((m) => ({
      content: m.body?.content ?? '',
      sender: m.sender?.id ?? '',
    }));
  }

  /**
   * Markdown -> feishu docx via the real 4-step drive importTask flow.
   * Real method names (verified against @larksuiteoapi/node-sdk):
   *   - drive.file.uploadAll (or upload_all chunked) -> file_token
   *   - drive.importTask.create({ file_token, type:'md', point:{type:'docx',...} }) -> ticket
   *   - poll drive.importTask.get({ ticket }) until result.job_status === 0 (success)
   *   - result returns token = the new docx's document_id; build URL via known prefix
   * The full code is ~40 lines; this stub leaves a clearly marked TODO so M-8
   * implementers don't ship a silent placeholder.
   */
  async docImportMarkdown(p: { markdownPath: string; title: string }): Promise<{ docId: string; url: string }> {
    const sdk = await this.ensureSdk();
    void sdk; void p;
    throw new Error(
      'docImportMarkdown not yet implemented · see M-8 step note about drive.importTask + polling',
    );
  }

  /**
   * Wiki node create. `node_type` is `'origin' | 'shortcut'`; `obj_type` is one
   * of `'doc' | 'sheet' | 'mindnote' | 'bitable' | 'file' | 'docx' | 'slides'`.
   * `obj_token` (NOT shown in original plan) is the docx token to link.
   */
  async wikiNodeCreate(p: {
    spaceId: string;
    parentNodeToken: string;
    docId: string; // = obj_token from docImportMarkdown
    title: string;
  }): Promise<{ nodeToken: string }> {
    const sdk = await this.ensureSdk();
    // SDK v1.66 typings omit `obj_token` from the request body, but the live
    // Feishu API requires it to attach an existing docx (without it, a new
    // empty docx is created instead of linking p.docId). Cast around the
    // typing gap; the runtime payload is correct per
    // https://open.feishu.cn/document/.../wiki-v2/space-node/create
    const payload = {
      path: { space_id: p.spaceId },
      data: {
        parent_node_token: p.parentNodeToken,
        obj_type: 'docx',
        node_type: 'origin',
        obj_token: p.docId,
        title: p.title,
      },
    };
    const res = await sdk.wiki.spaceNode.create(payload as Parameters<typeof sdk.wiki.spaceNode.create>[0]);
    return { nodeToken: res.data?.node?.node_token ?? '' };
  }

  /**
   * Search workspace chats by query string. Real method is `im.chat.search`
   * (NOT `im.chat.list` — `list` enumerates chats the bot already belongs to).
   */
  async searchChats(p: { query: string }): Promise<Array<{ chatId: string; name: string }>> {
    const sdk = await this.ensureSdk();
    const res = await sdk.im.chat.search({ params: { query: p.query, page_size: 20 } });
    return (res.data?.items ?? []).map((c) => ({
      chatId: c.chat_id ?? '',
      name: c.name ?? '',
    }));
  }
}
