import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { MulticaClient } from '@tcmcp/shared';

export const caseCreateInput = z.object({
  projectPath: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  goal: z.string().min(1),
  whatHappened: z.string().min(1).max(1500), // ~200 words
  criteriaResults: z.array(z.object({
    criterion: z.string(),
    met: z.boolean(),
    notMetReason: z.string().optional(),
  })),
  keyJudgments: z.array(z.object({
    title: z.string(),
    context: z.string(),
    options: z.array(z.string()),
    chose: z.string(),
    inHindsight: z.string(),
    ancientImpossible: z.string(),
  })).min(1),
  ruleCandidates: z.array(z.string()).max(3).default([]),
  multicaProjectId: z.string().optional(),
  // Original plan issue id — when present, the case issue is linked to it via
  // parent_issue_id so case_review can traverse up and auto-close the plan.
  planIssueId: z.string().optional(),
});

export type CaseCreateInput = z.infer<typeof caseCreateInput>;

export interface CaseCreateOutput {
  casePath: string;
  multicaIssueId: string;
}

export async function caseCreate(
  raw: CaseCreateInput,
  deps: { client: MulticaClient }
): Promise<CaseCreateOutput> {
  const input = caseCreateInput.parse(raw);
  const date = new Date().toISOString().slice(0, 10);
  const casePath = join(input.projectPath, 'cases', `${date}-${input.slug}.md`);

  try {
    await access(casePath);
    throw new Error(`case already exists: ${casePath}`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      // re-throw if our "already exists" check OR another error
      if (String(e).includes('already exists')) throw e;
    }
  }

  await mkdir(dirname(casePath), { recursive: true });
  const body = renderCase(input);
  await writeFile(casePath, body, 'utf-8');

  const issue = await deps.client.createIssue({
    title: `复盘:${input.slug}`,
    body: `Case file: \`${casePath}\``,
    labels: ['复盘-待审'],
    projectId: input.multicaProjectId,
  });

  // 修D · structured link back to the plan issue. createIssue has no parent
  // param, so set parent_issue_id via updateIssue — this is what lets
  // case_review traverse up and auto-close the plan when the case is approved.
  if (input.planIssueId) {
    await deps.client.updateIssue(issue.id, { parentIssueId: input.planIssueId });
  }

  return { casePath, multicaIssueId: issue.id };
}

function renderCase(i: CaseCreateInput): string {
  const criteria = i.criteriaResults
    .map((c) =>
      `- [${c.met ? 'x' : ' '}] ${c.criterion}${c.met ? '' : c.notMetReason ? ` — ${c.notMetReason}` : ''}`
    )
    .join('\n');

  const judgments = i.keyJudgments
    .map(
      (j) =>
        `### 判断:${j.title}\n` +
        `- **背景:** ${j.context}\n` +
        `- **选项:** ${j.options.join(' / ')}\n` +
        `- **选择:** ${j.chose}\n` +
        `- **事后看:** ${j.inHindsight}\n` +
        `- **"古法不可能"检验:** ${j.ancientImpossible}\n`
    )
    .join('\n');

  const candidates = i.ruleCandidates.length
    ? i.ruleCandidates.map((c) => `- [ ] 待 DRI 决定是否晋升: ${c}`).join('\n')
    : '_(无 — 本项目无通用规则候选)_';

  return `# 复盘:${i.slug}

## 1. 目标
${i.goal}

## 2. 实际发生了什么
${i.whatHappened}

## 3. 完成标准
${criteria}

## 4. 关键判断
${judgments}

## 5. 通用规则候选
${candidates}
`;
}
