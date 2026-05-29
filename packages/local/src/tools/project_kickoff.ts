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
  multicaResearchIssueId: string;
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

  await writeFile(researchPath, `# 研究:${input.topic}

## 问题
<一段话:我们想搞清楚什么>

## 发现
### 现有代码
- TBD

### 先例
- TBD

### 陷阱
- TBD

### 约束
- TBD

## 待解问题
- TBD

## 推荐方案
1. TBD
`);

  await writeFile(planPath, `---
version: 1.0
layer: project
dri: ${input.dri}
---
# 计划:${input.slug}

**创建:** ${date}
**DRI:** ${input.dri}
**层级:** project

## 目标
${input.goalDraft}

## 完成标准
- [ ] TBD (DRI 在 Research 后填写)

## 分工
- DRI: ${input.dri}
- EXEC: _(invoke role-assignment-protocol skill)_
- COLLAB: _(invoke role-assignment-protocol skill)_
- REVIEW: _(assign before Implement phase)_

## 投入预算
${input.appetite}

## 研究输入
${researchPath.replace(input.projectPath + '/', '')}

## 方案
_(Research 后填写)_

## 评审
- Reviewer: _(pending)_
- Reviewed: _(pending)_
- Verdict: pending

## 当前状态(交接槽 · 见 pre-clear skill)
_(首次交接前为空)_
`);

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

  // Broadcast hint: caller LLM should chain to notify_team after this returns.
  // SOP Phase 01 Step 6 announce — handled by orchestrator, not inline shell-out.
  const goalSnippet = input.goalDraft.length > 100
    ? input.goalDraft.slice(0, 100) + '…'
    : input.goalDraft;

  return {
    researchPath, planPath,
    multicaProjectId: project.id,
    multicaResearchIssueId: researchIssue.id,
    multicaIssueId: issue.id,
    broadcastSuggestion: {
      tool: 'notify_team',
      text: `Starting ${input.slug} · DRI ${input.dri} · ${goalSnippet}`,
    },
  };
}
