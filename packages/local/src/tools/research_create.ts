import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { MulticaClient } from '@tcmcp/shared';
import { renderResearchHtml } from '../render/research-html.js';

export const researchCreateInput = z.object({
  projectPath: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  // Required: every issue MUST live under a project (pick via `multica project
  // list`; the skill enforces certainty / ask-the-user-if-unsure).
  projectId: z.string().min(1),
  question: z.string().min(20),
});

export interface ResearchCreateOutput {
  researchPath: string;
  multicaIssueId: string;
  alreadyExisted: boolean;
  attachmentId: string | null;
  uploadError?: string;
}

export async function researchCreate(
  raw: z.infer<typeof researchCreateInput>,
  deps: { client: MulticaClient }
): Promise<ResearchCreateOutput> {
  const input = researchCreateInput.parse(raw);
  const date = new Date().toISOString().slice(0, 10);
  const researchPath = join(
    input.projectPath, 'docs', 'research',
    `research_${date}_${input.slug}.html`
  );

  const html = renderResearchHtml(input);

  let existed = false;
  try {
    await access(researchPath);
    existed = true;
  } catch {
    await mkdir(dirname(researchPath), { recursive: true });
    await writeFile(researchPath, html, 'utf-8');
  }

  const issue = await deps.client.createIssue({
    title: `研究:${input.slug}`,
    body:
      `📄 调研进行中 · 发现完成后以**评论**形式发布(\`doc_publish\` · !file 内联渲染)。\n` +
      `本地骨架:\`${researchPath}\`\n\nResearch question: ${input.question}`,
    labels: ['研究'],
    projectId: input.projectId,
  });

  // research_create does NOT publish a doc at create time — the skeleton has no
  // findings yet (renderResearchHtml only knows the question). The agent fills
  // the local HTML, then publishes it as a COMMENT via the doc_publish tool
  // (append-only · !file embed) — never by mutating an attachment or rewriting
  // the description. Uploading an empty skeleton here is exactly what stranded
  // the earlier flow (immutable attachment + no fill path).

  return { researchPath, multicaIssueId: issue.id, alreadyExisted: existed, attachmentId: null };
}
