import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import type { MulticaClient } from '../lib/multica.js';

const responseSchema = z.object({
  q1: z.enum(['yes', 'no']),
  q2: z.enum(['yes', 'no']),
  q3: z.enum(['yes', 'no']),
});

export const burnoutCheckDistributeInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('distribute'),
    teamEmails: z.array(z.string().email()).min(1),
    month: z.string().regex(/^\d{4}-\d{2}$/),
  }),
  z.object({
    action: z.literal('collect'),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    teamContextRepo: z.string(),
    // Either: caller supplies responses (manual / external survey fallback)
    responses: z.array(responseSchema).optional(),
    // Or: caller supplies teamEmails so we auto-scrape P2P history via feishu-cli
    teamEmails: z.array(z.string().email()).optional(),
    driEmail: z.string().email(),
  }).refine(
    (v) => (v.responses && v.responses.length > 0) || (v.teamEmails && v.teamEmails.length > 0),
    { message: 'collect requires either responses[] or teamEmails[]' },
  ),
]);

const QUESTIONS = [
  'q1: 这个月跑 5-10 active Claude，你觉得疲惫吗？',
  'q2: 这个月有没有出现"看到通知就反感"的感觉？',
  'q3: 下班后还在想 Claude session 状态吗？',
];

/** Send burnout check P2P via feishu-cli msg send (one DM per team member). */
function feishuSendP2P(email: string, text: string): void {
  execFileSync('feishu-cli', [
    'msg', 'send',
    '--receive-id-type', 'email',
    '--receive-id', email,
    '--text', text,
  ], { stdio: 'pipe' });
}

/** Read P2P chat history with a single member via feishu-cli. Returns parsed messages JSON. */
function feishuReadP2P(email: string, sinceISO: string): Array<{ content: string }> {
  const out = execFileSync('feishu-cli', [
    'msg', 'history',
    '--user-email', email,
    '--since', sinceISO,
    '--limit', '50',
    '--output', 'json',
  ]).toString();
  try {
    const parsed = JSON.parse(out);
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

/** Extract q1/q2/q3 yes-no from member's reply messages. Drop sender — anonymize. */
function parseResponse(messages: Array<{ content: string }>): z.infer<typeof responseSchema> | null {
  const text = messages.map((m) => m.content || '').join('\n').toLowerCase();
  const m1 = /q1\s*[:：]\s*(yes|no|y|n|是|否)/.exec(text);
  const m2 = /q2\s*[:：]\s*(yes|no|y|n|是|否)/.exec(text);
  const m3 = /q3\s*[:：]\s*(yes|no|y|n|是|否)/.exec(text);
  if (!m1 || !m2 || !m3) return null;
  const norm = (v: string): 'yes' | 'no' =>
    ['yes', 'y', '是'].includes(v) ? 'yes' : 'no';
  return { q1: norm(m1[1]), q2: norm(m2[1]), q3: norm(m3[1]) };
}

export async function burnoutCheckDistribute(
  raw: z.infer<typeof burnoutCheckDistributeInput>,
  deps: { client: MulticaClient }
): Promise<any> {
  const input = burnoutCheckDistributeInput.parse(raw);

  if (input.action === 'distribute') {
    const msg = [
      `Burnout check · ${input.month} · 匿名（聚合时丢弃 sender）`,
      '',
      QUESTIONS.join('\n'),
      '',
      '请直接在本 1-on-1 私聊里回复，格式：',
      'q1: yes/no',
      'q2: yes/no',
      'q3: yes/no',
      '',
      `月底 ${input.month}-28 后 burnout_check_distribute 工具 collect 阶段会拉取本月本群历史 + 匿名化聚合。`,
    ].join('\n');

    let sent = 0;
    const failed: string[] = [];
    for (const email of input.teamEmails) {
      try {
        feishuSendP2P(email, msg);
        sent++;
      } catch {
        failed.push(email);
      }
    }
    return { sentCount: sent, failedEmails: failed };
  }

  if (input.action === 'collect') {
    // Path A: caller supplied responses (manual / external form). Use as-is.
    // Path B: caller supplied teamEmails. Auto-scrape via feishu-cli.
    let responses: Array<z.infer<typeof responseSchema>> = [];
    if (input.responses && input.responses.length > 0) {
      responses = input.responses;
    } else if (input.teamEmails && input.teamEmails.length > 0) {
      const sinceISO = `${input.month}-01`;
      for (const email of input.teamEmails) {
        const msgs = feishuReadP2P(email, sinceISO);
        const parsed = parseResponse(msgs);
        if (parsed) responses.push(parsed);
        // If no parse: member did not reply this month. Drop silently.
      }
    }

    const yesCount = responses.reduce(
      (acc, r) => acc + (r.q1 === 'yes' ? 1 : 0) + (r.q2 === 'yes' ? 1 : 0) + (r.q3 === 'yes' ? 1 : 0),
      0
    );

    // Anonymized aggregate (sender info discarded above; only yes/no counts retained)
    const report = [
      `# Burnout Check · ${input.month}`,
      '',
      `**Responses**: ${responses.length}`,
      `**Total "yes" answers**: ${yesCount}`,
      '',
      '## Per-question tally (anonymized)',
      `- Q1 (疲惫): ${responses.filter(r => r.q1 === 'yes').length} yes`,
      `- Q2 (反感通知): ${responses.filter(r => r.q2 === 'yes').length} yes`,
      `- Q3 (下班还想 session): ${responses.filter(r => r.q3 === 'yes').length} yes`,
      '',
      '## Threshold',
      yesCount > 0
        ? `⚠️ At least one "yes" — SOP P-6 Monthly says this month降到 3-5 active 调整. DRI must review.`
        : '✅ Zero "yes" — continue at baseline 5-10 active.',
    ].join('\n');

    const path = join(input.teamContextRepo, 'health', 'burnout', `${input.month}.md`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, report, 'utf-8');

    let alertIssueId: string | undefined;
    if (yesCount > 0) {
      const issue = await deps.client.createIssue({
        title: `Burnout signal · ${input.month}`,
        body: `Burnout check ${input.month} returned ${yesCount} "yes" answer(s). Per SOP P-6, consider reducing active count this month. Report: ${path}`,
        labels: ['burnout-alert', 'urgent'],
      });
      alertIssueId = issue.id;
    }

    return { yesCount, reportPath: path, alertIssueId };
  }

  throw new Error('unknown action');
}
