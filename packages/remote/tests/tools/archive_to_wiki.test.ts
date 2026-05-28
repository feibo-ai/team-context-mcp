import { describe, it, expect, vi, beforeEach } from 'vitest';

const docImportMarkdown = vi.fn();
const wikiNodeCreate = vi.fn();

vi.mock('@tcmcp/feishu', () => ({
  FeishuClient: class {
    docImportMarkdown = docImportMarkdown;
    wikiNodeCreate = wikiNodeCreate;
  },
}));

import { FeishuClient } from '@tcmcp/feishu';
import { archiveToWiki } from '../../src/tools/archive_to_wiki.js';

type ConfigStub = {
  get<T = unknown>(key: string): T | undefined;
  getSecret(key: string): Promise<string | undefined>;
  version(): number;
  onChange(cb: (k: string) => void): () => void;
};

function makeConfig(store: Record<string, unknown>): ConfigStub {
  return {
    get: <T = unknown>(k: string) => store[k] as T | undefined,
    getSecret: async (k: string) => store[k] as string | undefined,
    version: () => 1,
    onChange: () => () => {},
  };
}

describe('archive_to_wiki', () => {
  let feishu: FeishuClient;

  beforeEach(() => {
    docImportMarkdown.mockReset();
    wikiNodeCreate.mockReset();
    docImportMarkdown.mockResolvedValue({ docId: 'doc-token-xyz', url: 'https://example.feishu.cn/docx/doc-token-xyz' });
    wikiNodeCreate.mockResolvedValue({ nodeToken: 'node-token-abc' });
    feishu = new (FeishuClient as unknown as new () => FeishuClient)();
  });

  it('imports markdown then creates wiki node · returns docUrl + nodeToken', async () => {
    const config = makeConfig({
      feishu_wiki_space_id: 'space-1',
      feishu_wiki_default_parent: 'parent-1',
    });

    const res = await archiveToWiki(
      { markdownPath: '/tmp/case.md', title: 'Debrief: feed latency' },
      { config, feishu },
    );

    expect(docImportMarkdown).toHaveBeenCalledWith({
      markdownPath: '/tmp/case.md',
      title: 'Debrief: feed latency',
    });
    expect(wikiNodeCreate).toHaveBeenCalledWith({
      spaceId: 'space-1',
      parentNodeToken: 'parent-1',
      docId: 'doc-token-xyz',
      title: 'Debrief: feed latency',
    });
    expect(res).toEqual({
      docUrl: 'https://example.feishu.cn/docx/doc-token-xyz',
      nodeToken: 'node-token-abc',
    });
  });

  it('args override config-resolved space + parent', async () => {
    const config = makeConfig({
      feishu_wiki_space_id: 'space-default',
      feishu_wiki_default_parent: 'parent-default',
    });

    await archiveToWiki(
      {
        markdownPath: '/tmp/case.md',
        title: 'Override',
        wikiSpaceId: 'space-override',
        parentNodeToken: 'parent-override',
      },
      { config, feishu },
    );

    expect(wikiNodeCreate).toHaveBeenCalledWith({
      spaceId: 'space-override',
      parentNodeToken: 'parent-override',
      docId: 'doc-token-xyz',
      title: 'Override',
    });
  });

  it('throws if both config + args miss space_id or parent', async () => {
    const config = makeConfig({});

    await expect(
      archiveToWiki(
        { markdownPath: '/tmp/case.md', title: 'No config' },
        { config, feishu },
      ),
    ).rejects.toThrow(/wiki_space_id and parent_node_token required/);

    expect(docImportMarkdown).not.toHaveBeenCalled();
    expect(wikiNodeCreate).not.toHaveBeenCalled();
  });

  it('throws if space_id resolves but parent does not', async () => {
    const config = makeConfig({ feishu_wiki_space_id: 'space-1' });

    await expect(
      archiveToWiki(
        { markdownPath: '/tmp/case.md', title: 'Half config' },
        { config, feishu },
      ),
    ).rejects.toThrow(/wiki_space_id and parent_node_token required/);
  });
});
