import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { z } from 'zod';
import type { MulticaClient } from '@tcmcp/shared';

export const docPublishInput = z.object({
  multicaIssueId: z.string().min(1),
  // Local doc to publish (e.g. the filled docs/research/research_*.html). Its
  // basename becomes the attachment filename.
  docPath: z.string().min(1),
  // Comment caption shown above the inline render. Defaults to a generic line.
  caption: z.string().optional(),
  // Override the upload content-type (default text/html for the 方案A docs).
  contentType: z.string().optional(),
});

export interface DocPublishOutput {
  attachmentId: string;
  commentId: string;
  url?: string;
  filename: string;
}

/**
 * Publish a local doc to a multica issue as an APPEND-ONLY COMMENT whose body
 * embeds it via `!file[name](url)` (renders inline) and binds the upload. This
 * is the agent-facing path for filling a research_create skeleton or posting any
 * new doc version. It replaces the dead-ends that stranded the earlier flow:
 * the CLI's `attachment` can only download (no re-upload), and rewriting the
 * issue description diverges from the attachment. Every call is a NEW comment;
 * nothing is ever mutated.
 */
export async function docPublish(
  raw: z.infer<typeof docPublishInput>,
  deps: { client: MulticaClient }
): Promise<DocPublishOutput> {
  const input = docPublishInput.parse(raw);
  const html = await readFile(input.docPath, 'utf-8');
  const filename = basename(input.docPath);
  const pub = await deps.client.publishDoc(input.multicaIssueId, {
    html,
    filename,
    caption: input.caption ?? '文档(方案A · 下方渲染)',
    contentType: input.contentType,
  });
  return { ...pub, filename };
}
