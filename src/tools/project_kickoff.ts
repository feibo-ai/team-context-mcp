import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { MulticaClient } from '../lib/multica.js';

export const projectKickoffInput = z.object({
  projectPath: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  topic: z.string().min(5),
  dri: z.string().min(1),
  goalDraft: z.string().min(10),
  appetite: z.string().default('1 week'),
  feishuChatId: z.string().optional(),  // oc_xxx; if set, broadcast via feishu-cli
});

export async function projectKickoff(
  raw: z.infer<typeof projectKickoffInput>,
  deps: { client: MulticaClient }
): Promise<{
  researchPath: string;
  planPath: string;
  multicaProjectId: string;
  multicaIssueId: string;
}> {
  const input = projectKickoffInput.parse(raw);
  const date = new Date().toISOString().slice(0, 10);

  const researchPath = join(input.projectPath, 'docs', 'research', `research_${date}_${input.slug}.md`);
  const planPath = join(input.projectPath, 'docs', 'plans', `plan_${date}_${input.slug}.md`);

  await mkdir(dirname(researchPath), { recursive: true });
  await mkdir(dirname(planPath), { recursive: true });

  await writeFile(researchPath, `# Research: ${input.topic}

## Question
<one paragraph: what we are trying to understand>

## Findings
### Existing codebase
- TBD

### Prior art
- TBD

### Pitfalls
- TBD

### Constraints
- TBD

## Open questions
- TBD

## Recommended approaches
1. TBD
`);

  await writeFile(planPath, `---
version: 1.0
layer: project
dri: ${input.dri}
---
# Plan: ${input.slug}

**Created:** ${date}
**DRI:** ${input.dri}
**Layer:** project

## Goal
${input.goalDraft}

## Completion criteria
- [ ] TBD (DRI fills in after Research)

## How to split
- DRI: ${input.dri}
- EXEC: _(invoke role-assignment-protocol skill)_
- COLLAB: _(invoke role-assignment-protocol skill)_
- REVIEW: _(assign before Implement phase)_

## Appetite
${input.appetite}

## Research input
${researchPath.replace(input.projectPath + '/', '')}

## Approach
_(fill in after Research session)_

## Review
- Reviewer: _(pending)_
- Reviewed: _(pending)_
- Verdict: pending

## Current State (handoff slot — see pre-clear skill)
_(empty until first handoff)_
`);

  // Create multica project
  const project = await (deps.client as any).req('/api/projects', {
    method: 'POST',
    body: { title: input.slug, description: input.topic },
  });

  // Create initial issue
  const issue = await deps.client.createIssue({
    title: `Plan: ${input.slug}`,
    body: `Project kickoff via project_kickoff tool.\n\nPlan: \`${planPath}\`\nResearch: \`${researchPath}\``,
    labels: ['plan-draft'],
    projectId: project.id,
  });

  // Optional feishu broadcast via feishu-cli (SOP Phase 01 Step 6)
  if (input.feishuChatId) {
    try {
      const { execFileSync } = await import('node:child_process');
      const text = `[Kickoff] ${input.slug} · DRI: ${input.dri} · Appetite: ${input.appetite} · Goal: ${input.goalDraft}`;
      execFileSync('feishu-cli', [
        'msg', 'send',
        '--receive-id-type', 'chat_id',
        '--receive-id', input.feishuChatId,
        '--text', text,
      ], { stdio: 'pipe' });
    } catch {
      // best-effort; don't fail tool. log to stderr for daemon to see.
      process.stderr.write(`[project_kickoff] feishu broadcast failed for ${input.slug}\n`);
    }
  }

  return {
    researchPath, planPath,
    multicaProjectId: project.id,
    multicaIssueId: issue.id,
  };
}
