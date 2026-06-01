import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { MulticaClient } from '@tcmcp/shared';
import { renderResearchHtml } from '../render/research-html.js';

export const researchCreateInput = z.object({
  projectPath: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
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
    body: `Research session for: ${input.question}\n\nFile: \`${researchPath}\``,
    labels: ['研究'],
  });

  let attachmentId: string | null = null;
  let uploadError: string | undefined;
  try {
    const att = await deps.client.uploadFile(html, `research_${date}_${input.slug}_v1.html`, issue.id, 'text/html');
    attachmentId = att.id;
  } catch (e) {
    uploadError = (e as Error).message;
  }

  return { researchPath, multicaIssueId: issue.id, alreadyExisted: existed, attachmentId, uploadError };
}
