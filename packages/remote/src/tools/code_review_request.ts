import { z } from 'zod';
import type { MulticaClient } from '@tcmcp/shared';

export const codeReviewRequestInput = z.object({
  implementerAgentId: z.string(),
  reviewerAgentId: z.string(),
  commitHash: z.string().regex(/^[a-f0-9]{7,40}$/),
  prUrl: z.string().url().optional(),
  context: z.string().min(10),
});

export async function codeReviewRequest(
  raw: z.infer<typeof codeReviewRequestInput>,
  deps: { client: MulticaClient }
): Promise<{ reviewIssueId: string }> {
  const input = codeReviewRequestInput.parse(raw);

  if (input.implementerAgentId === input.reviewerAgentId) {
    throw new Error(
      'self-review refused: implementerAgentId == reviewerAgentId. SOP ❌1: code review must be by a DIFFERENT session.'
    );
  }

  const body = [
    `## 代码评审请求`,
    ``,
    `**实现者**: agent ${input.implementerAgentId}`,
    `**评审者**: 你 (agent ${input.reviewerAgentId})`,
    `**提交**: \`${input.commitHash}\``,
    input.prUrl ? `**PR**: ${input.prUrl}` : '',
    ``,
    `## 背景`,
    input.context,
    ``,
    `## 评审清单 (SOP 关键节点把关)`,
    `- [ ] 是否存在结构性 bug (不只是表面问题)`,
    `- [ ] 是否引入了 ❌6 能力前沿外的实现`,
    `- [ ] 测试是否真覆盖了 happy path 和边界`,
    `- [ ] 是否有 vibe code 痕迹 (没 plan 直接写)`,
    `- [ ] commit message 是否对应 plan 章节`,
    ``,
    `回复结论: \`approved\` | \`changes-requested: <原因>\``,
  ].filter(Boolean).join('\n');

  const issue = await deps.client.createIssue({
    title: `代码评审:${input.commitHash.slice(0, 7)}`,
    body,
    labels: ['代码评审'],
    assigneeId: input.reviewerAgentId,
    assigneeType: 'agent',
  });

  return { reviewIssueId: issue.id };
}
