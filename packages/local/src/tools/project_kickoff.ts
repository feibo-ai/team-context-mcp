import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { MulticaClient } from '@tcmcp/shared';
import { fileEmbed } from '@tcmcp/shared';
import { renderResearchHtml } from '../render/research-html.js';
import { renderPlanHtml } from '../render/plan-html.js';

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
  researchAttachmentId: string | null;
  planAttachmentId: string | null;
  multicaProjectId: string;
  multicaResearchIssueId: string;
  multicaIssueId: string;
  broadcastSuggestion: {
    tool: 'notify_team';
    text: string;
  };
}> {
  const input = projectKickoffInput.parse(raw);
  const date = new Date().toISOString().slice(0, 10);

  const researchPath = join(input.projectPath, 'docs', 'research', `research_${date}_${input.slug}.html`);
  const planPath = join(input.projectPath, 'docs', 'plans', `plan_${date}_${input.slug}.html`);

  await mkdir(dirname(researchPath), { recursive: true });
  await mkdir(dirname(planPath), { recursive: true });

  const researchHtml = renderResearchHtml({ slug: input.slug, question: input.topic } as any);
  const planHtml = renderPlanHtml({
    slug: input.slug,
    layer: 'project',
    dri: input.dri,
    goal: input.goalDraft,
    completionCriteria: [],
  } as any);

  await writeFile(researchPath, researchHtml);
  await writeFile(planPath, planHtml);

  // Create multica project
  const project = await (deps.client as any).req('/api/projects', {
    method: 'POST',
    body: { title: input.slug, description: input.topic },
  });

  // Research is a standalone tracking unit (研究 label). Create its issue first
  // so the plan issue can link to it. NOTE: this is a scaffold STUB — real
  // research still needs a fresh rpi-research session (flagged in the body).
  const researchIssue = await deps.client.createIssue({
    title: `研究:${input.slug}`,
    body:
      `Research stub: \`${researchPath}\`\n` +
      `⚠️ 这是脚手架占位 · 真调研需另开 fresh session 跑 rpi-research 深度填充。\n\n` +
      `Part of project kickoff for ${input.slug}.`,
    labels: ['研究'],
    projectId: project.id,
  });

  // Plan issue, linked to the research issue above.
  const issue = await deps.client.createIssue({
    title: `计划:${input.slug}`,
    body:
      `Project kickoff via project_kickoff tool.\n\n` +
      `Plan: \`${planPath}\`\nResearch: \`${researchPath}\`\n` +
      `Research issue: ${researchIssue.id}`,
    labels: ['计划-草稿'],
    projectId: project.id,
  });

  // Upload each HTML doc as an attachment on its issue, then embed it in that
  // issue's description so it renders inline (issue-level binding alone has no
  // render surface — see fileEmbed). Upload failure must NOT throw — local files
  // + issues are already persisted; attachment + embed are best-effort.
  let researchAttachmentId: string | null = null;
  let planAttachmentId: string | null = null;
  const researchFilename = `research_${date}_${input.slug}_v1.html`;
  const planFilename = `plan_${date}_${input.slug}_v1.html`;
  try {
    const att = await deps.client.uploadFile(researchHtml, researchFilename, researchIssue.id, 'text/html');
    researchAttachmentId = att.id;
    if (att.url) {
      await deps.client.updateIssue(researchIssue.id, {
        description: `研究文档(方案A · 下方渲染):\n\n${fileEmbed(researchFilename, att.url)}`,
        attachmentIds: [att.id],
      });
    }
  } catch {}
  try {
    const att = await deps.client.uploadFile(planHtml, planFilename, issue.id, 'text/html');
    planAttachmentId = att.id;
    if (att.url) {
      await deps.client.updateIssue(issue.id, {
        description: `计划文档(方案A · 下方渲染):\n\n${fileEmbed(planFilename, att.url)}`,
        attachmentIds: [att.id],
      });
    }
  } catch {}

  // Broadcast hint: caller LLM should chain to notify_team after this returns.
  // SOP Phase 01 Step 6 announce — handled by orchestrator, not inline shell-out.
  const goalSnippet = input.goalDraft.length > 100
    ? input.goalDraft.slice(0, 100) + '…'
    : input.goalDraft;

  return {
    researchPath, planPath,
    researchAttachmentId,
    planAttachmentId,
    multicaProjectId: project.id,
    multicaResearchIssueId: researchIssue.id,
    multicaIssueId: issue.id,
    broadcastSuggestion: {
      tool: 'notify_team',
      text: `Starting ${input.slug} · DRI ${input.dri} · ${goalSnippet}`,
    },
  };
}
