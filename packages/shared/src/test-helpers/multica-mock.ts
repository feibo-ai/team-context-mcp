/**
 * Test helpers for stubbing the multica REST API via undici MockAgent.
 *
 * Two real-multica behaviors that drove this helper:
 * 1. POST /api/issues body uses `description`, not `body`. The MulticaClient
 *    translates this — tests don't need to care.
 * 2. Labels are NOT settable at create time. They go through a separate
 *    POST /api/issues/<id>/labels with a `label_id` (UUID). So every test
 *    that creates an issue with labels needs to intercept those follow-up
 *    POSTs. `interceptAnyLabelAdd()` below adds a catch-all.
 *
 * The MulticaClient looks up label name → UUID via GET /api/labels. To
 * avoid that round-trip in tests, pass the pre-seeded `STANDARD_LABEL_MAP`
 * via the client's `labelMap` constructor option.
 */
import type { MockAgent, MockPool } from 'undici';

/**
 * Canonical labels with stub UUIDs. English names are kept as legacy aliases so
 * generic client tests + the still-English remote tools (code-review /
 * betting-table / burnout-alert) keep resolving; the Chinese names are the
 * current ones applied by the localized plan / case / research tools and map to
 * the same stub UUIDs (same label concept, renamed in multica).
 */
export const STANDARD_LABEL_MAP: Record<string, string> = {
  // English (legacy aliases)
  'plan-draft': 'lbl-plan-draft',
  'plan-under-review': 'lbl-plan-under-review',
  'plan-approved': 'lbl-plan-approved',
  'plan-upgraded': 'lbl-plan-upgraded',
  'debrief': 'lbl-debrief',
  'debrief-reviewed': 'lbl-debrief-reviewed',
  'ancient-impossible': 'lbl-ancient-impossible',
  'betting-table': 'lbl-betting-table',
  'burnout-alert': 'lbl-burnout-alert',
  'code-review': 'lbl-code-review',
  'research': 'lbl-research',
  'urgent': 'lbl-urgent',
  // Chinese (current — applied by the localized tools)
  '计划-草稿': 'lbl-plan-draft',
  '计划-评审中': 'lbl-plan-under-review',
  '计划-已批准': 'lbl-plan-approved',
  '计划-已升级': 'lbl-plan-upgraded',
  '复盘-待审': 'lbl-debrief',
  '复盘-已审': 'lbl-debrief-reviewed',
  '研究': 'lbl-research',
};

/**
 * Install a persistent catch-all intercept for POST /api/issues/<id>/labels.
 * Each label-add call returns 201 {} regardless of which issue or label_id.
 */
export function interceptAnyLabelAdd(pool: MockPool): void {
  pool
    .intercept({
      path: (p: string) => /^\/api\/issues\/[^/]+\/labels$/.test(p),
      method: 'POST',
    })
    .reply(201, {})
    .persist();
}
