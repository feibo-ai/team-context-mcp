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
      `# Betting Table — week of ${input.weekOf}`,
      '',
      `Proposals (${input.proposals.length}):`,
      '',
      ...input.proposals.map((p) =>
        `- **${p.id}** · ${p.title} _(by ${p.proposer})_${p.oneLiner ? ` — ${p.oneLiner}` : ''}`
      ),
      '',
      '## Voting',
      '',
      'Comment on this issue with: `vote: p1, p3` (up to 3 votes per person).',
      '',
      '> Per SOP P-6 W-04: un-voted proposals are DROPPED. No backlog.',
    ].join('\n');

    const issue = await deps.client.createIssue({
      title: `Betting Table · week of ${input.weekOf}`,
      body: lines,
      labels: ['betting-table'],
    });

    return {
      bettingIssueId: issue.id,
      proposalsCount: input.proposals.length,
      votingInstructions: `Comment "vote: <proposal-ids>" on issue ${issue.id}`,
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
      '## Voting closed',
      '',
      ...ranked.map(([id, count], i) =>
        `${i < input.topK ? '✅' : '❌'} ${id}: ${count} vote${count > 1 ? 's' : ''}`
      ),
      '',
      `Winners (top ${input.topK}): ${winners.map((w) => w[0]).join(', ')}`,
      '',
      '**Un-voted/below-cutoff candidates are DROPPED per SOP P-6 W-04. No backlog.**',
    ].join('\n');

    await deps.client.commentOnIssue(input.bettingIssueId, summary);

    return {
      winners: winners.map(([id, count]) => ({ id, count })),
      droppedCount: ranked.length - winners.length,
    };
  }

  throw new Error('unknown action');
}
