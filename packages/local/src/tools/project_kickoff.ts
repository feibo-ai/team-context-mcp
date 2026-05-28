import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { MulticaClient } from '@tcmcp/shared';

export const projectKickoffInput = z.object({
  projectPath: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  topic: z.string().min(5),
  dri: z.string().min(1),
  goalDraft: z.string().min(10),
  appetite: z.string().default('1 week'),
});

export async function projectKickoff(
  raw: z.infer<typeof projectKickoffInput>,
  deps: { client: MulticaClient }
): Promise<{
  researchPath: string;
  planPath: string;
  multicaProjectId: string;
  multicaIssueId: string;
  broadcastSuggestion: {
    tool: 'notify_team';
    text: string;
  };
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

  // Broadcast hint: caller LLM should chain to notify_team after this returns.
  // SOP Phase 01 Step 6 announce — handled by orchestrator, not inline shell-out.
  const goalSnippet = input.goalDraft.length > 100
    ? input.goalDraft.slice(0, 100) + '…'
    : input.goalDraft;

  return {
    researchPath, planPath,
    multicaProjectId: project.id,
    multicaIssueId: issue.id,
    broadcastSuggestion: {
      tool: 'notify_team',
      text: `Starting ${input.slug} · DRI ${input.dri} · ${goalSnippet}`,
    },
  };
}
