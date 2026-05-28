// archive_to_wiki.ts — Plan 5 Task M-11
//
// Reads a local markdown file path, imports it as a Feishu docx, then attaches
// it as an origin node under a wiki space. Returns the doc URL + wiki node token.
//
// space_id and parent_node_token are optional in the input; they fall back to
// config (multica integration values). Either source must supply both.

import { z } from 'zod';
import type { ConfigSource } from '@tcmcp/config';
import type { FeishuClient } from '@tcmcp/feishu';

export const archiveToWikiInput = z.object({
  markdownPath: z.string(),
  title: z.string().min(1),
  wikiSpaceId: z.string().optional(),       // falls back to config
  parentNodeToken: z.string().optional(),   // falls back to config
});

export async function archiveToWiki(
  raw: z.infer<typeof archiveToWikiInput>,
  deps: { config: ConfigSource; feishu: FeishuClient },
): Promise<{ docUrl: string; nodeToken: string }> {
  const input = archiveToWikiInput.parse(raw);
  const spaceId = input.wikiSpaceId ?? deps.config.get<string>('feishu_wiki_space_id');
  const parent = input.parentNodeToken ?? deps.config.get<string>('feishu_wiki_default_parent');
  if (!spaceId || !parent) {
    throw new Error('wiki_space_id and parent_node_token required (config or args)');
  }
  const doc = await deps.feishu.docImportMarkdown({
    markdownPath: input.markdownPath,
    title: input.title,
  });
  const node = await deps.feishu.wikiNodeCreate({
    spaceId,
    parentNodeToken: parent,
    docId: doc.docId,
    title: input.title,
  });
  return { docUrl: doc.url, nodeToken: node.nodeToken };
}
