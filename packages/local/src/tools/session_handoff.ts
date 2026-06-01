import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { GitOps } from '@tcmcp/shared';
import { upsertSection } from '@tcmcp/shared';
import type { MulticaClient } from '@tcmcp/shared';
import { renderPlanHtml, type HandoffState } from '../render/plan-html.js';
import type { PlanCreateInput } from './plan_create.js';

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
  // Optional: full structured plan. When provided (with multicaIssueId), the
  // plan HTML is regenerated, the local .html is overwritten, and a NEW
  // attachment is appended — comment behavior stays unchanged.
  planInput: z.any().optional(),
});

export type SessionHandoffInput = Omit<z.infer<typeof sessionHandoffInput>, 'planInput'> & {
  planInput?: PlanCreateInput;
};

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
  const input = sessionHandoffInput.parse(raw) as SessionHandoffInput;
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
  const isHtml = planPath.toLowerCase().endsWith('.html');

  // Step 3: idempotency check — refuse if last handoff was < 60s ago. The marker
  // only exists in markdown plans (HTML plans are regenerated, not appended), so
  // this is a no-op safeguard for .html — duplicate HTML handoffs are harmless
  // (extra comment + attachment, no corruption).
  const planText = await readFile(planPath, 'utf-8');
  const recent = /handoff @ (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/.exec(planText);
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

  // Persist to the local plan file ONLY for markdown plans — appending a
  // markdown section to a generated .html doc would corrupt it (glue text after
  // </html>). For HTML plans the Current State lives in the issue comment
  // (Step 5) and the regenerated HTML's handoff section (Step 6).
  if (!isHtml) {
    await writeFile(planPath, upsertSection(planText, '当前状态', block), 'utf-8');
  }

  // Step 5: optional multica comment (existing behavior — unchanged)
  let multicaCommentId: string | undefined;
  if (input.multicaIssueId && deps.client) {
    const comment = await deps.client.commentOnIssue(input.multicaIssueId, block);
    multicaCommentId = comment.id;
  }

  // Step 6: optional — regenerate plan HTML, overwrite local .html, append as
  // a NEW attachment. Backward-compatible: only runs when the full structured
  // plan AND an issue id are provided. Comment behavior above stays untouched.
  if (input.planInput && input.multicaIssueId && deps.client) {
    const handoff: HandoffState = {
      at: ts,
      lastCommit: commitHash.slice(0, 7),
      branch: status.branch,
      done: input.currentState,
      nextAction: input.nextAction,
      deadEnds: input.deadEnds,
      pollutionSignal: input.pollutionSignal,
    };
    const html = renderPlanHtml(input.planInput, handoff);
    // Overwrite the local file with the regenerated HTML. Use the RESOLVED
    // planPath (not input.planPath, which is undefined when auto-discovered),
    // and only when it's actually an .html plan.
    if (isHtml) await writeFile(planPath, html, 'utf-8');
    try {
      await deps.client.uploadFile(
        html,
        `plan_handoff_${Date.now()}.html`,
        input.multicaIssueId,
        'text/html'
      );
    } catch {
      /* non-fatal — comment already posted, local file written */
    }
  }

  return { planPath, commitHash, filesCommitted, multicaCommentId };
}

async function findLatestPlan(projectPath: string): Promise<string> {
  const plansDir = join(projectPath, 'docs', 'plans');
  const files = await readdir(plansDir);
  const plans = files.filter((f) => f.endsWith('.html') || f.endsWith('.md'));
  if (plans.length === 0) throw new Error(`no plan doc (.html/.md) found in ${plansDir}`);
  const stats = await Promise.all(
    plans.map(async (f) => ({ name: f, mtime: (await stat(join(plansDir, f))).mtimeMs }))
  );
  stats.sort((a, b) => b.mtime - a.mtime);
  return join(plansDir, stats[0].name);
}
