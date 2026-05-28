import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { MulticaClient } from '@tcmcp/shared';

export const researchCreateInput = z.object({
  projectPath: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  question: z.string().min(20),
});

export async function researchCreate(
  raw: z.infer<typeof researchCreateInput>,
  deps: { client: MulticaClient }
): Promise<{ researchPath: string; multicaIssueId: string; alreadyExisted: boolean }> {
  const input = researchCreateInput.parse(raw);
  const date = new Date().toISOString().slice(0, 10);
  const researchPath = join(
    input.projectPath, 'docs', 'research',
    `research_${date}_${input.slug}.md`
  );

  let existed = false;
  try {
    await access(researchPath);
    existed = true;
  } catch {
    await mkdir(dirname(researchPath), { recursive: true });
    const body = `# Research: ${input.slug}

**Date**: ${date}
**Researcher**: (your name / your-claude-session-id)

## Question
${input.question}

## Findings

### Existing codebase
- TBD

### Prior art
- TBD (industry papers / similar repos / known references)

### Pitfalls
- TBD (known failure modes / foot-guns)

### Constraints
- TBD (team SOP / security / compliance / time)

## Open questions
- TBD (things research couldn't answer — must resolve before Plan session)

## Recommended approaches (options, not decisions)
1. TBD
2. TBD
3. TBD
`;
    await writeFile(researchPath, body, 'utf-8');
  }

  const issue = await deps.client.createIssue({
    title: `Research: ${input.slug}`,
    body: `Research session for: ${input.question}\n\nFile: \`${researchPath}\``,
    labels: ['research'],
  });

  return { researchPath, multicaIssueId: issue.id, alreadyExisted: existed };
}
