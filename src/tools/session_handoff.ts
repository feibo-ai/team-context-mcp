import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { GitOps } from '@tcmcp/shared';
import { upsertSection } from '@tcmcp/shared';
import type { MulticaClient } from '../lib/multica.js';

export const sessionHandoffInput = z.object({
  projectPath: z.string(),
  planPath: z.string().optional(),
  currentState: z.string().min(1),
  nextAction: z.string().min(1),
  pollutionSignal: z.string().min(1),
  deadEnds: z.array(z.string()).default([]),
  wipStrategy: z.enum(['commit', 'stash', 'discard', 'none']).default('commit'),
  wipMessage: z.string().optional(),
  multicaIssueId: z.string().optional(),
  confirmDiscard: z.boolean().optional(),
});

export type SessionHandoffInput = z.infer<typeof sessionHandoffInput>;

export interface SessionHandoffOutput {
  planPath: string;
  commitHash: string;
  filesCommitted: string[];
  multicaCommentId?: string;
}

export async function sessionHandoff(
  raw: SessionHandoffInput,
  deps: { client?: MulticaClient }
): Promise<SessionHandoffOutput> {
  const input = sessionHandoffInput.parse(raw);
  const git = new GitOps(input.projectPath);

  const status = await git.status();

  // Step 1: WIP fate
  let commitHash = (await git.lastCommit()).hash;
  const filesCommitted: string[] = [];
  if (!status.clean) {
    if (input.wipStrategy === 'commit') {
      commitHash = await git.commitWip(input.wipMessage || 'session handoff');
      filesCommitted.push(...status.uncommittedFiles);
    } else if (input.wipStrategy === 'stash') {
      await git.stashWip(input.wipMessage || 'session handoff');
    } else if (input.wipStrategy === 'discard') {
      if (!input.confirmDiscard) {
        throw new Error(
          'wipStrategy=discard requires confirmDiscard=true. This destroys uncommitted work.'
        );
      }
      // intentionally not implemented automatic discard — refuse by default
      throw new Error(
        'discard not auto-executed. Run `git checkout .` manually after confirming.'
      );
    }
  }

  // Step 2: locate plan
  const planPath = input.planPath || (await findLatestPlan(input.projectPath));

  // Step 3: idempotency check — refuse if last handoff was < 60s ago
  const planText = await readFile(planPath, 'utf-8');
  const recent = /Current State \(handoff @ ([\d-T:]+)/.exec(planText);
  if (recent) {
    const age = Date.now() - new Date(recent[1]).getTime();
    if (age < 60_000) {
      throw new Error(
        `last handoff was ${Math.floor(age / 1000)}s ago — refusing duplicate within 60s.`
      );
    }
  }

  // Step 4: write Current State section
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const block = [
    `(handoff @ ${ts})`,
    '',
    `**Last commit**: \`${commitHash.slice(0, 7)}\``,
    `**Worktree**: ${status.branch}, ${status.uncommittedFiles.length} uncommitted file(s)`,
    '',
    `**What's done**:`,
    `- ${input.currentState}`,
    '',
    `**Next action**:`,
    `- ${input.nextAction}`,
    '',
    `**Dead ends — do NOT retry**:`,
    ...(input.deadEnds.length ? input.deadEnds.map((d) => `- ${d}`) : ['- _(none)_']),
    '',
    `**Pollution signal**: ${input.pollutionSignal}`,
  ].join('\n');

  const updated = upsertSection(planText, 'Current State', block);
  await writeFile(planPath, updated, 'utf-8');

  // Step 5: optional multica comment
  let multicaCommentId: string | undefined;
  if (input.multicaIssueId && deps.client) {
    const comment = await deps.client.commentOnIssue(input.multicaIssueId, block);
    multicaCommentId = comment.id;
  }

  return { planPath, commitHash, filesCommitted, multicaCommentId };
}

async function findLatestPlan(projectPath: string): Promise<string> {
  const plansDir = join(projectPath, 'docs', 'plans');
  const files = await readdir(plansDir);
  const mds = files.filter((f) => f.endsWith('.md'));
  if (mds.length === 0) throw new Error(`no plan markdown found in ${plansDir}`);
  const stats = await Promise.all(
    mds.map(async (f) => ({ name: f, mtime: (await stat(join(plansDir, f))).mtimeMs }))
  );
  stats.sort((a, b) => b.mtime - a.mtime);
  return join(plansDir, stats[0].name);
}
