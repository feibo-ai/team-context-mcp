import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { MulticaClient } from '@tcmcp/shared';
import { renderPlanHtml } from '../render/plan-html.js';
import type { PlanCreateInput } from './plan_create.js';

export const planUpgradeInput = z.object({
  planPath: z.string(),
  multicaIssueId: z.string(),
  reason: z.string().min(10),
  // Full structured plan fields, supplied so the HTML can be regenerated
  // wholesale. Typed as PlanCreateInput on the inferred type below.
  planInput: z.any().optional(),
  // New attachment version number (default 2). v1, v2... accumulate on the
  // issue so the plan's evolution stays traceable. This is the single source of
  // version truth — there is no separate local snapshot/frontmatter scheme.
  version: z.number().optional(),
});

export type PlanUpgradeInput = Omit<z.infer<typeof planUpgradeInput>, 'planInput'> & {
  planInput?: PlanCreateInput;
};

export interface PlanUpgradeOutput {
  version: number;
  attachmentId: string | null;
  uploadError?: string;
}

export async function planUpgrade(
  raw: PlanUpgradeInput,
  deps: { client: MulticaClient }
): Promise<PlanUpgradeOutput> {
  const input = planUpgradeInput.parse(raw) as PlanUpgradeInput;
  const version = input.version ?? 2;

  // State-machine transition (always runs): an upgrade means the plan is no
  // longer approved → clear 计划-已批准, mark 计划-已升级 + re-enter 计划-草稿,
  // and move status back to in_review (the bumped plan needs a fresh review).
  await deps.client.removeLabel(input.multicaIssueId, '计划-已批准');
  await deps.client.addLabel(input.multicaIssueId, '计划-已升级');
  await deps.client.addLabel(input.multicaIssueId, '计划-草稿');
  await deps.client.updateIssue(input.multicaIssueId, { status: 'in_review' });

  // Degraded mode: without the structured plan fields we cannot regenerate the
  // HTML, so only the label/status flow runs (the skill is responsible for
  // passing planInput when it wants a fresh doc + attachment).
  let attachmentId: string | null = null;
  let uploadError: string | undefined;
  if (input.planInput) {
    const html = renderPlanHtml(input.planInput);
    // Overwrite the local file (keep latest). Versions accumulate on the issue
    // as attachments — NOT as local snapshots — so the plan file is always the
    // current HTML, never markdown/frontmatter.
    await writeFile(input.planPath, html, 'utf-8');
    try {
      // Publish v{version} as a COMMENT (append-only · !file inline render).
      // ONE call uploads + comments + binds — replaces the old description
      // rewrite + separate text comment, which duplicated content and left the
      // description diverging from the attachment. The reason rides in caption.
      const pub = await deps.client.publishDoc(input.multicaIssueId, {
        html,
        filename: `plan_v${version}.html`,
        caption: `计划已升级到 v${version}(原因:${input.reason}) · 新 HTML 已发布`,
      });
      attachmentId = pub.attachmentId;
    } catch (e) {
      // Publish failure is non-fatal — the label/status transition already
      // landed and the local HTML is written. Still leave a comment recording
      // the upgrade so the issue reflects the bump; surface the error.
      uploadError = (e as Error).message;
      await deps.client.commentOnIssue(
        input.multicaIssueId,
        `计划已升级到 v${version}(原因:${input.reason})(⚠️ 附件发布失败:${uploadError} · 本地 HTML 已更新,可重试 doc_publish)`
      );
    }
  }

  return { version, attachmentId, uploadError };
}
