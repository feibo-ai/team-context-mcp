import { z } from 'zod';
import type { MulticaClient } from '@tcmcp/shared';

export const bettingTableCaptureInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('open'),
    weekOf: z.string(), // YYYY-MM-DD of upcoming Monday
    proposals: z.array(z.object({
      id: z.string(),
      title: z.string(),
      proposer: z.string(),
      oneLiner: z.string().optional(),
    })).min(1).max(20),
  }),
  z.object({
    action: z.literal('close'),
    bettingIssueId: z.string(),
    votes: z.record(z.string(), z.array(z.string())), // voterEmail → [proposalIds]
    topK: z.number().int().min(1).max(10).default(5),
  }),
]);

export async function bettingTableCapture(
  raw: z.infer<typeof bettingTableCaptureInput>,
  deps: { client: MulticaClient }
): Promise<any> {
  const input = bettingTableCaptureInput.parse(raw);

  if (input.action === 'open') {
    const lines = [
      `# 投注表 — ${input.weekOf} 当周`,
      '',
      `提案 (${input.proposals.length}):`,
      '',
      ...input.proposals.map((p) =>
        `- **${p.id}** · ${p.title} _(由 ${p.proposer} 提)_${p.oneLiner ? ` — ${p.oneLiner}` : ''}`
      ),
      '',
      '## 投票',
      '',
      '在本 issue 评论:`vote: p1, p3`(每人最多 3 票)。',
      '',
      '> 依 SOP P-6 W-04:未投票的提案直接丢弃,不留 backlog。',
    ].join('\n');

    const issue = await deps.client.createIssue({
      title: `投注表 · ${input.weekOf} 当周`,
      body: lines,
      labels: ['投注表'],
    });

    return {
      bettingIssueId: issue.id,
      proposalsCount: input.proposals.length,
      votingInstructions: `在 issue ${issue.id} 评论 "vote: <提案ID>"`,
    };
  }

  if (input.action === 'close') {
    // Tally votes
    const tally: Record<string, number> = {};
    for (const props of Object.values(input.votes)) {
      for (const p of props) tally[p] = (tally[p] || 0) + 1;
    }
    const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    const winners = ranked.slice(0, input.topK);

    // Post tally to issue
    const summary = [
      '## 投票结束',
      '',
      ...ranked.map(([id, count], i) =>
        `${i < input.topK ? '✅' : '❌'} ${id}: ${count} 票`
      ),
      '',
      `胜出 (前 ${input.topK}): ${winners.map((w) => w[0]).join(', ')}`,
      '',
      '**未投票/未进前列的提案依 SOP P-6 W-04 丢弃,不留 backlog。**',
    ].join('\n');

    await deps.client.commentOnIssue(input.bettingIssueId, summary);

    return {
      winners: winners.map(([id, count]) => ({ id, count })),
      droppedCount: ranked.length - winners.length,
    };
  }

  throw new Error('unknown action');
}
