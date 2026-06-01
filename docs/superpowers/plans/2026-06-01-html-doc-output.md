# 中间文档 HTML 化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** plan/research/case 工具改为生成「方案A 衡线公文」HTML,落本地 `.html` + 上传 multica 并关联 issue,issue 内直接渲染。

**Architecture:** TS 模板函数(结构化字段→HTML 字符串,共享 `_template-base.ts` 的方案A CSS)。MulticaClient 新增 `uploadFile`(undici FormData → `POST /api/upload-file`,带 `file` + `issue_id` 字段,一个请求完成上传+关联)。建文档工具改 md→html+上传;更新文档工具整篇重生成+追加新附件。

**Tech Stack:** TypeScript · pnpm monorepo · undici 7(FormData/Blob/request)· vitest

**Spec:** `/Users/feibo/multica/docs/superpowers/specs/2026-06-01-html-doc-output-design.md`

**关键实测事实(已查证,直接用):**
- `POST /api/upload-file` multipart 字段:`file`(文件)+ 可选 `issue_id`(关联 issue,同请求完成,无需单独 attach API)。返回 `{ id, filename, content_type, size_bytes, created_at, url? }`,取 `id`。
- 蓝本:`tc-multica/server/internal/cli/client.go:338` 的 `UploadFile`(Go 版,照搬逻辑到 TS)。
- client `req()` 用 undici `request` + `Bearer token` + `X-Workspace-Id` header(`multica-client.ts:40`)。undici 7 有原生 `FormData`/`Blob`。
- 附件 2MB 上限,模板 ~3.5KB 不会触发。
- 模板样例:`/tmp/html-templates/A-letterpress.html`。

---

## File Structure

| 文件 | 责任 |
|---|---|
| `packages/local/src/render/template-base.ts` (新) | 方案A 的 `<style>` 常量 + `renderShell({eyebrow,title,metaItems,sectionsHtml})` 骨架 + `esc()` HTML 转义 |
| `packages/local/src/render/plan-html.ts` (新) | `renderPlanHtml(input)` → HTML |
| `packages/local/src/render/research-html.ts` (新) | `renderResearchHtml(input)` → HTML |
| `packages/local/src/render/case-html.ts` (新) | `renderCaseHtml(input)` → HTML |
| `packages/shared/src/multica-client.ts` (改) | +`uploadFile(content, filename, issueId?, contentType?)` |
| `packages/local/src/tools/plan_create.ts` (改) | md→html + 写本地 .html + uploadFile(issueId) |
| `packages/local/src/tools/research_create.ts` (改) | 同上 |
| `packages/local/src/tools/case_create.ts` (改) | 同上 |
| `packages/local/src/tools/project_kickoff.ts` (改) | 2 issue 各生成+上传 HTML |
| `packages/local/src/tools/plan_upgrade.ts` (改) | 整篇重生成 + 追加新版本附件 |
| `packages/local/src/tools/session_handoff.ts` (改) | 整篇重生成 + 追加附件 + 保留 comment |

---

### Task 1: HTML 模板基座 `template-base.ts`

**Files:**
- Create: `packages/local/src/render/template-base.ts`
- Test: `packages/local/tests/render/template-base.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/local/tests/render/template-base.test.ts
import { describe, it, expect } from 'vitest';
import { esc, renderShell } from '../../src/render/template-base.js';

describe('template-base', () => {
  it('esc 转义 HTML 特殊字符', () => {
    expect(esc('<a> & "b" \'c\'')).toBe('&lt;a&gt; &amp; &quot;b&quot; &#39;c&#39;');
  });

  it('renderShell 产出自包含 HTML · 含标题/eyebrow/section · 系统字体无外链', () => {
    const html = renderShell({
      eyebrow: 'PLAN · 计划',
      title: 'demo-slug',
      metaItems: [{ label: 'DRI', value: 'feibo' }],
      sectionsHtml: '<h2>目标</h2><div class="field">x</div>',
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('demo-slug');
    expect(html).toContain('PLAN · 计划');
    expect(html).toContain('<h2>目标</h2>');
    expect(html).toContain('Songti SC');        // 系统宋体字体栈
    expect(html).not.toContain('fonts.googleapis'); // 零外链
    expect(html).not.toContain('http://');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/feibo/feibo/team-context-mcp && pnpm --filter @tcmcp/local test render/template-base -- --run`
Expected: FAIL — Cannot find module template-base

- [ ] **Step 3: Write implementation**

```ts
// packages/local/src/render/template-base.ts
//
// 方案A · 衡线公文 HTML 模板基座。纯自包含(零外链 · 系统字体),
// 跑在 multica issue 的 sandboxed iframe(allow-scripts · opaque origin)里。
// 样例见 /tmp/html-templates/A-letterpress.html。

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
:root{--ink:#1A1A1A;--ink2:#2D2D2D;--paper:#F5F2EB;--paper2:#EDE8DC;--accent:#C73E1D;--gray:#8B8680;--border:#D4CFC4;--green:#4A6B3A;--gold:#B8862E}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Songti SC","Noto Serif SC",Georgia,serif;background:var(--paper);color:var(--ink);line-height:1.8;font-size:15px;padding:48px 40px;max-width:760px;margin:0 auto}
.eyebrow{font-family:"SF Mono",Menlo,monospace;font-size:11px;letter-spacing:3px;color:var(--accent);text-transform:uppercase;margin-bottom:14px}
h1{font-weight:900;font-size:40px;line-height:1.15;letter-spacing:-1px;margin-bottom:18px;border-bottom:3px double var(--ink);padding-bottom:20px}
.meta{display:flex;gap:32px;flex-wrap:wrap;font-family:"SF Mono",Menlo,monospace;font-size:12px;color:var(--gray);margin-bottom:36px}
.meta b{color:var(--ink);font-weight:600}
h2{font-weight:700;font-size:22px;margin:36px 0 14px;padding-left:14px;border-left:4px solid var(--accent)}
.field{background:#fff;border:1px solid var(--border);padding:18px 22px;margin-bottom:14px}
.field-label{font-family:"SF Mono",Menlo,monospace;font-size:10px;letter-spacing:1.5px;color:var(--gray);text-transform:uppercase;margin-bottom:6px}
ul{list-style:none;margin:8px 0}
li{padding:6px 0 6px 24px;position:relative}
li::before{content:"▸";position:absolute;left:4px;color:var(--accent)}
.crit li::before{content:"☐";color:var(--green)}
code{font-family:"SF Mono",Menlo,monospace;background:var(--paper2);padding:1px 6px;border-radius:2px;font-size:13px}
.callout{background:var(--paper2);border-left:4px solid var(--gold);padding:14px 18px;margin:18px 0;font-size:14px}
footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--border);font-family:"SF Mono",Menlo,monospace;font-size:11px;color:var(--gray)}
`;

export interface ShellInput {
  eyebrow: string;
  title: string;
  metaItems: Array<{ label: string; value: string }>;
  sectionsHtml: string;
  footer?: string;
}

export function renderShell(input: ShellInput): string {
  const meta = input.metaItems
    .map((m) => `<span>${esc(m.label)} <b>${esc(m.value)}</b></span>`)
    .join('');
  const footer = esc(input.footer ?? 'team-context · 渲染自 multica issue HTML 附件');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(input.title)}</title>
<style>${STYLE}</style></head>
<body>
<div class="eyebrow">${esc(input.eyebrow)}</div>
<h1>${esc(input.title)}</h1>
<div class="meta">${meta}</div>
${input.sectionsHtml}
<footer>${footer}</footer>
</body></html>
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tcmcp/local test render/template-base -- --run`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/local/src/render/template-base.ts packages/local/tests/render/template-base.test.ts
git commit -m "feat(render): 方案A 衡线公文 HTML 模板基座 (esc + renderShell)"
```

---

### Task 2: `renderPlanHtml`

**Files:**
- Create: `packages/local/src/render/plan-html.ts`
- Test: `packages/local/tests/render/plan-html.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/local/tests/render/plan-html.test.ts
import { describe, it, expect } from 'vitest';
import { renderPlanHtml } from '../../src/render/plan-html.js';

describe('renderPlanHtml', () => {
  it('project plan 含 5 段 + 字段填充 + HTML escape', () => {
    const html = renderPlanHtml({
      slug: 'tetris-mvp',
      layer: 'project',
      dri: 'feibo',
      goal: '玩一局 <Tetris>',
      completionCriteria: ['单文件 index.html', '7 键'],
      appetite: '2-3 小时',
      exec: ['feibo'],
      reviewer: 'feibo',
      approach: 'vanilla JS',
    } as any);
    expect(html).toContain('tetris-mvp');
    expect(html).toContain('目标');
    expect(html).toContain('完成标准');
    expect(html).toContain('投入预算');
    expect(html).toContain('玩一局 &lt;Tetris&gt;');   // escape 生效
    expect(html).toContain('单文件 index.html');
    expect(html).toContain('计划');                     // eyebrow
  });

  it('task layer 精简版仍产出合法 HTML', () => {
    const html = renderPlanHtml({
      slug: 'quick-fix', layer: 'task',
      goal: 'fix bug', completionCriteria: ['done when green'],
    } as any);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('quick-fix');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tcmcp/local test render/plan-html -- --run`
Expected: FAIL — Cannot find module plan-html

- [ ] **Step 3: Write implementation**

```ts
// packages/local/src/render/plan-html.ts
import { esc, renderShell } from './template-base.js';
import type { PlanCreateInput } from '../tools/plan_create.js';

export function renderPlanHtml(input: PlanCreateInput): string {
  const crit = (input.completionCriteria ?? [])
    .map((c) => `<li>${esc(c)}</li>`)
    .join('');
  const exec = (input.exec ?? []).join(', ') || '_(未分配)_';
  const collab = (input.collab ?? []).join(', ') || '_(无)_';
  const reviewer = input.reviewer || '_(待指派)_';

  const sections = [
    `<h2>目标</h2><div class="field"><div class="field-label">Goal</div>${esc(input.goal)}</div>`,
    `<h2>完成标准</h2><div class="field crit"><ul>${crit}</ul></div>`,
    `<h2>分工</h2><div class="field"><div class="field-label">Roles</div>DRI <code>${esc(input.dri ?? '_(指派)_')}</code> · EXEC <code>${esc(exec)}</code> · COLLAB <code>${esc(collab)}</code> · REVIEW <code>${esc(reviewer)}</code></div>`,
    `<h2>投入预算</h2><div class="callout"><b>${esc(input.appetite ?? '_(设定)_')}</b> · 超时触发 plan_upgrade(升版强制重审)。</div>`,
    input.approach ? `<h2>方案</h2><div class="field">${esc(input.approach)}</div>` : '',
  ].join('\n');

  return renderShell({
    eyebrow: `PLAN · 计划 · ${input.layer === 'task' ? 'task' : 'project'}`,
    title: input.slug,
    metaItems: [
      { label: 'DRI', value: input.dri ?? '—' },
      { label: 'Layer', value: input.layer },
      { label: 'Appetite', value: input.appetite ?? '—' },
    ],
    sectionsHtml: sections,
    footer: 'team-context · RPI Plan phase · multica issue 内渲染',
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tcmcp/local test render/plan-html -- --run`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/local/src/render/plan-html.ts packages/local/tests/render/plan-html.test.ts
git commit -m "feat(render): renderPlanHtml 方案A plan 模板"
```

---

### Task 3: `renderResearchHtml`

**Files:**
- Create: `packages/local/src/render/research-html.ts`
- Test: `packages/local/tests/render/research-html.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/local/tests/render/research-html.test.ts
import { describe, it, expect } from 'vitest';
import { renderResearchHtml } from '../../src/render/research-html.js';

describe('renderResearchHtml', () => {
  it('含问题段 + escape + 自包含', () => {
    const html = renderResearchHtml({ slug: 'r-test', question: 'how to <x>?' } as any);
    expect(html).toContain('r-test');
    expect(html).toContain('问题');
    expect(html).toContain('how to &lt;x&gt;?');
    expect(html).toContain('RESEARCH · 研究');
    expect(html).toContain('<!DOCTYPE html>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tcmcp/local test render/research-html -- --run`
Expected: FAIL — Cannot find module

- [ ] **Step 3: Write implementation**

```ts
// packages/local/src/render/research-html.ts
import { esc, renderShell } from './template-base.js';
import type { ResearchCreateInput } from '../tools/research_create.js';

export function renderResearchHtml(input: ResearchCreateInput): string {
  const sections = [
    `<h2>问题</h2><div class="field"><div class="field-label">Question</div>${esc(input.question)}</div>`,
    `<h2>发现</h2><div class="field"><div class="field-label">Findings</div>_(待 fresh session 深度调研填充)_</div>`,
    `<h2>待解问题</h2><div class="field">_(research 过程中浮现的开放问题)_</div>`,
  ].join('\n');

  return renderShell({
    eyebrow: 'RESEARCH · 研究',
    title: input.slug,
    metaItems: [{ label: 'Phase', value: 'RPI Research' }],
    sectionsHtml: sections,
    footer: 'team-context · RPI Research phase · multica issue 内渲染',
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tcmcp/local test render/research-html -- --run`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add packages/local/src/render/research-html.ts packages/local/tests/render/research-html.test.ts
git commit -m "feat(render): renderResearchHtml 方案A research 模板"
```

---

### Task 4: `renderCaseHtml`

**Files:**
- Create: `packages/local/src/render/case-html.ts`
- Test: `packages/local/tests/render/case-html.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/local/tests/render/case-html.test.ts
import { describe, it, expect } from 'vitest';
import { renderCaseHtml } from '../../src/render/case-html.js';

describe('renderCaseHtml', () => {
  it('含 5 段 SOP case + judgments + escape', () => {
    const html = renderCaseHtml({
      slug: 'c-test',
      goal: 'ship <thing>',
      whatHappened: 'did <stuff>',
      criteriaResults: [{ criterion: 'crit-1', met: true }, { criterion: 'crit-2', met: false, notMetReason: 'blocked' }],
      keyJudgments: [{
        title: 'J1', context: 'ctx', options: ['A', 'B'],
        chose: 'A', inHindsight: 'ok', ancientImpossible: 'yes',
      }],
      ruleCandidates: ['rule x'],
    } as any);
    expect(html).toContain('c-test');
    expect(html).toContain('目标');
    expect(html).toContain('实际发生');
    expect(html).toContain('完成标准');
    expect(html).toContain('关键判断');
    expect(html).toContain('规则候选');
    expect(html).toContain('ship &lt;thing&gt;');
    expect(html).toContain('crit-1');
    expect(html).toContain('J1');
    expect(html).toContain('CASE · 复盘');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tcmcp/local test render/case-html -- --run`
Expected: FAIL — Cannot find module

- [ ] **Step 3: Write implementation**

```ts
// packages/local/src/render/case-html.ts
import { esc, renderShell } from './template-base.js';
import type { CaseCreateInput } from '../tools/case_create.js';

export function renderCaseHtml(input: CaseCreateInput): string {
  const crits = (input.criteriaResults ?? [])
    .map((c) => {
      const mark = c.met ? '✅' : '❌';
      const reason = !c.met && c.notMetReason ? ` — ${esc(c.notMetReason)}` : '';
      return `<li>${mark} ${esc(c.criterion)}${reason}</li>`;
    })
    .join('');

  const judgments = (input.keyJudgments ?? [])
    .map((j) => `<div class="field"><div class="field-label">判断:${esc(j.title)}</div>
<b>背景</b> ${esc(j.context)}<br>
<b>选项</b> ${esc((j.options ?? []).join(' / '))}<br>
<b>选择</b> ${esc(j.chose)}<br>
<b>事后看</b> ${esc(j.inHindsight)}<br>
<b>古法不可能</b> ${esc(j.ancientImpossible)}</div>`)
    .join('\n');

  const rules = (input.ruleCandidates ?? []).length
    ? `<ul>${(input.ruleCandidates ?? []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
    : '_(无)_';

  const sections = [
    `<h2>1 · 目标</h2><div class="field">${esc(input.goal)}</div>`,
    `<h2>2 · 实际发生</h2><div class="field">${esc(input.whatHappened)}</div>`,
    `<h2>3 · 完成标准</h2><div class="field crit"><ul>${crits}</ul></div>`,
    `<h2>4 · 关键判断</h2>${judgments}`,
    `<h2>5 · 规则候选</h2><div class="field">${rules}</div>`,
  ].join('\n');

  return renderShell({
    eyebrow: 'CASE · 复盘',
    title: input.slug,
    metaItems: [{ label: 'Phase', value: 'RPI Debrief' }],
    sectionsHtml: sections,
    footer: 'team-context · RPI Debrief · SOP 非妥协 #2 · multica issue 内渲染',
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tcmcp/local test render/case-html -- --run`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add packages/local/src/render/case-html.ts packages/local/tests/render/case-html.test.ts
git commit -m "feat(render): renderCaseHtml 方案A case 模板"
```

---

### Task 5: MulticaClient `uploadFile`

**Files:**
- Modify: `packages/shared/src/multica-client.ts` (在 commentOnIssue 方法后加)
- Test: `packages/shared/tests/multica-client-upload.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/tests/multica-client-upload.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { MulticaClient } from '../src/multica-client.js';

let agent: MockAgent;
beforeEach(() => { agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent); });
afterEach(async () => { await agent.close(); });

describe('uploadFile', () => {
  it('POST /api/upload-file multipart · 返回 attachment id', async () => {
    const pool = agent.get('https://m.test');
    pool.intercept({ path: '/api/upload-file', method: 'POST' })
      .reply(200, { id: 'att-1', filename: 'plan.html', content_type: 'text/html' });
    const c = new MulticaClient({ serverUrl: 'https://m.test', token: 't', workspaceId: 'ws' });
    const r = await c.uploadFile('<html>x</html>', 'plan.html', 'issue-9');
    expect(r.id).toBe('att-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tcmcp/shared test multica-client-upload -- --run`
Expected: FAIL — uploadFile is not a function

- [ ] **Step 3: Write implementation** (加在 `multica-client.ts` 的 `commentOnIssue` 之后)

```ts
  /**
   * POST /api/upload-file — multipart. 字段 `file`(内容)+ 可选 `issue_id`
   * (同请求关联到 issue,无需单独 attach)。返回 attachment { id, ... }。
   * 蓝本:tc-multica/server/internal/cli/client.go UploadFile。
   */
  async uploadFile(
    content: string,
    filename: string,
    issueId?: string,
    contentType = 'text/html'
  ): Promise<{ id: string; url?: string }> {
    const form = new FormData();
    form.set('file', new Blob([content], { type: contentType }), filename);
    if (issueId) form.set('issue_id', issueId);

    const res = await request(`${this.cfg.serverUrl}/api/upload-file`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.token}`,
        'X-Workspace-Id': this.cfg.workspaceId,
      },
      body: form,
    });
    if (res.statusCode >= 400) {
      const text = await res.body.text();
      throw new Error(`upload-file ${res.statusCode}: ${text}`);
    }
    const json = (await res.body.json()) as { id: string; url?: string };
    if (!json.id) throw new Error('upload-file response missing id');
    return json;
  }
```

(注:`request` 已在文件顶部从 `undici` import。undici 7 的 `request` 接受 web `FormData` 作 body 并自动设 multipart Content-Type — 不要手动设 Content-Type header。`FormData`/`Blob` 是 Node 18+ 全局,无需 import。)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tcmcp/shared test multica-client-upload -- --run`
Expected: PASS
若 FormData-as-body 不被 undici request 接受(报错),fallback:用 undici 的 `fetch` 替代 `request` 仅此方法。先按 request 试。

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/multica-client.ts packages/shared/tests/multica-client-upload.test.ts
git commit -m "feat(client): uploadFile — multipart /api/upload-file + issue_id 关联"
```

---

### Task 6: plan_create 改 HTML 输出 + 上传

**Files:**
- Modify: `packages/local/src/tools/plan_create.ts`
- Test: `packages/local/tests/tools/plan_create.test.ts` (更新)

- [ ] **Step 1: 更新测试断言 .html + uploadFile 调用**

把 `plan_create.test.ts` 现有断言里的 `.md` 路径改 `.html`;mock client 加 `uploadFile` spy 断言被调用且 issueId 传入。具体:
```ts
// 在现有 plan_create test 里,mock client 增加:
const uploadFile = vi.fn().mockResolvedValue({ id: 'att-1' });
// deps.client mock 加 uploadFile
// 断言:
expect(r.planPath).toMatch(/docs\/plans\/plan_\d{4}-\d{2}-\d{2}_.*\.html$/);
expect(uploadFile).toHaveBeenCalled();
expect(r.attachmentId).toBe('att-1');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tcmcp/local test tools/plan_create -- --run`
Expected: FAIL — 还写 .md / 无 uploadFile

- [ ] **Step 3: 改 plan_create.ts**

把现有 `renderPlanMarkdown` 调用 + 写 `.md` 改成:
```ts
import { renderPlanHtml } from '../render/plan-html.js';
// ...
const planPath = join(input.projectPath, 'docs', 'plans', `plan_${date}_${input.slug}.html`);
const html = renderPlanHtml(input);
// 写本地(idempotency 检查保留:文件存在则不覆盖建 issue 前的)
let existed = false;
try { await access(planPath); existed = true; }
catch { await mkdir(dirname(planPath), { recursive: true }); await writeFile(planPath, html, 'utf-8'); }

const issue = await deps.client.createIssue({ title: `计划:${input.slug}`, body: `计划文档(HTML 附件已上传)`, labels: ['计划-草稿'] });

// 上传 HTML 关联 issue(失败不回滚)
let attachmentId: string | null = null;
let uploadError: string | undefined;
try {
  const att = await deps.client.uploadFile(html, `plan_${date}_${input.slug}_v1.html`, issue.id, 'text/html');
  attachmentId = att.id;
} catch (e) { uploadError = (e as Error).message; }

return { planPath, multicaIssueId: issue.id, alreadyExisted: existed, attachmentId, uploadError };
```
更新 `PlanCreateOutput` 接口加 `attachmentId: string | null` + `uploadError?: string`。删掉 `renderPlanMarkdown` 函数(已被 plan-html 取代)。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tcmcp/local test tools/plan_create -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/local/src/tools/plan_create.ts packages/local/tests/tools/plan_create.test.ts
git commit -m "feat(plan_create): HTML 输出 + 上传关联 issue"
```

---

### Task 7: research_create 改 HTML 输出 + 上传

**Files:**
- Modify: `packages/local/src/tools/research_create.ts`
- Test: `packages/local/tests/tools/research_create.test.ts` (更新)

- [ ] **Step 1: 更新测试** — 同 Task 6 模式:断言 `docs/research/research_*.html` + uploadFile 调用 + `r.attachmentId`。

- [ ] **Step 2: Run** `pnpm --filter @tcmcp/local test tools/research_create -- --run` → FAIL

- [ ] **Step 3: 改 research_create.ts** — 镜像 Task 6:
```ts
import { renderResearchHtml } from '../render/research-html.js';
const researchPath = join(input.projectPath, 'docs', 'research', `research_${date}_${input.slug}.html`);
const html = renderResearchHtml(input);
// 写本地(同 plan_create 的 access/mkdir/writeFile 模式)
const issue = await deps.client.createIssue({ title: `研究:${input.slug}`, body: '研究文档(HTML 附件已上传)', labels: ['研究'] });
let attachmentId: string | null = null; let uploadError: string | undefined;
try { const att = await deps.client.uploadFile(html, `research_${date}_${input.slug}_v1.html`, issue.id); attachmentId = att.id; }
catch (e) { uploadError = (e as Error).message; }
return { researchPath, multicaIssueId: issue.id, alreadyExisted: existed, attachmentId, uploadError };
```
更新返回接口加 attachmentId/uploadError。删旧 markdown 渲染。

- [ ] **Step 4: Run** → PASS

- [ ] **Step 5: Commit** `git commit -m "feat(research_create): HTML 输出 + 上传关联 issue"`

---

### Task 8: case_create 改 HTML 输出 + 上传

**Files:**
- Modify: `packages/local/src/tools/case_create.ts`
- Test: `packages/local/tests/tools/case_create.test.ts` (更新)

- [ ] **Step 1: 更新测试** — 断言 case 路径 `cases/${date}-${slug}.html`(实测现有格式是 `cases/<date>-<slug>.md`,即「日期-slug」连字符,**只改扩展名 .md→.html**,不改命名格式)+ uploadFile + attachmentId。保留现有 parent_issue_id link 断言(Task 不动那逻辑)。

- [ ] **Step 2: Run** `pnpm --filter @tcmcp/local test tools/case_create -- --run` → FAIL

- [ ] **Step 3: 改 case_create.ts** — renderCaseHtml + 写 `.html` + uploadFile。**保留**现有的 parent link(`if (input.planIssueId) updateIssue(...)`)。case 路径实测在 `case_create.ts:44` = `join(input.projectPath, 'cases', \`${date}-${input.slug}.md\`)`,**只把 `.md` 改 `.html`**(命名格式 `<date>-<slug>` 不变)。上传文件名用 `case_${date}_${input.slug}_v1.html`。
```ts
import { renderCaseHtml } from '../render/case-html.js';
const html = renderCaseHtml(input);
// casePath 改 .html(沿用现有目录)
const issue = await deps.client.createIssue({ title: `复盘:${input.slug}`, body: '复盘文档(HTML 附件已上传)', labels: ['复盘-待审'], projectId: input.multicaProjectId });
// 保留 parent link
if (input.planIssueId) await deps.client.updateIssue(issue.id, { parentIssueId: input.planIssueId });
let attachmentId: string | null = null; let uploadError: string | undefined;
try { const att = await deps.client.uploadFile(html, `case_${date}_${input.slug}_v1.html`, issue.id); attachmentId = att.id; }
catch (e) { uploadError = (e as Error).message; }
return { casePath, multicaIssueId: issue.id, attachmentId, uploadError };
```

- [ ] **Step 4: Run** → PASS

- [ ] **Step 5: Commit** `git commit -m "feat(case_create): HTML 输出 + 上传关联 issue"`

---

### Task 9: project_kickoff 改 HTML 输出 + 上传(2 issue)

**Files:**
- Modify: `packages/local/src/tools/project_kickoff.ts`
- Test: `packages/local/tests/tools/project_kickoff.test.ts` (更新)

- [ ] **Step 1: 更新测试** — 断言 research issue + plan issue 各自 `.html` 本地文件 + 各自 uploadFile 调用(2 次)+ 返回 `researchAttachmentId` / `planAttachmentId`。保留现有「建 2 issue + project_id」断言。

- [ ] **Step 2: Run** `pnpm --filter @tcmcp/local test tools/project_kickoff -- --run` → FAIL

- [ ] **Step 3: 改 project_kickoff.ts** — 现有它写 research/plan stub markdown,改成:
```ts
import { renderResearchHtml } from '../render/research-html.js';
import { renderPlanHtml } from '../render/plan-html.js';
// research stub
const researchPath = join(input.projectPath, 'docs', 'research', `research_${date}_${input.slug}.html`);
const researchHtml = renderResearchHtml({ slug: input.slug, question: input.topic } as any);
// 写 researchPath
const planPath = join(input.projectPath, 'docs', 'plans', `plan_${date}_${input.slug}.html`);
const planHtml = renderPlanHtml({ slug: input.slug, layer: 'project', dri: input.dri, goal: input.goalDraft, completionCriteria: [] } as any);
// 写 planPath
// ... 建 project + 2 issue(保留现有逻辑)...
// 各自上传(失败不回滚)
let researchAttachmentId=null, planAttachmentId=null;
try { researchAttachmentId = (await deps.client.uploadFile(researchHtml, `research_${date}_${input.slug}_v1.html`, researchIssue.id)).id; } catch {}
try { planAttachmentId = (await deps.client.uploadFile(planHtml, `plan_${date}_${input.slug}_v1.html`, planIssue.id)).id; } catch {}
// 返回值加 researchAttachmentId / planAttachmentId
```
更新返回接口。删旧 markdown stub 写入。

- [ ] **Step 4: Run** → PASS

- [ ] **Step 5: Commit** `git commit -m "feat(project_kickoff): 2 issue HTML 输出 + 上传"`

---

### Task 10: plan_upgrade 整篇重生成 + 追加新版本附件

**Files:**
- Modify: `packages/local/src/tools/plan_upgrade.ts`
- Test: `packages/local/tests/tools/plan_upgrade.test.ts` (更新)

- [ ] **Step 1: 更新测试** — 断言:重生成 HTML 写本地 `.html`(覆盖)+ uploadFile 用递增版本文件名(`_v2.html`)+ issue comment 被调说明升版。保留现有 label 互斥 + status in_review 断言(Task 不动那逻辑)。
```ts
// mock client.uploadFile + commentOnIssue spy
expect(uploadFile).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/_v\d+\.html$/), 'issue-id', 'text/html');
expect(commentOnIssue).toHaveBeenCalled();
```
版本号:plan_upgrade 入参需带 version(看现有 input;若无,从一个简单计数推断 — 实现时用入参 reason 里或加 version 字段,默认 v2)。

- [ ] **Step 2: Run** `pnpm --filter @tcmcp/local test tools/plan_upgrade -- --run` → FAIL

- [ ] **Step 3: 改 plan_upgrade.ts** — 现有它加 label;补:
```ts
import { renderPlanHtml } from '../render/plan-html.js';
// plan_upgrade 需要完整 plan input 才能重生成。若现有入参只有 multicaIssueId/planPath/reason,
// 则需扩展入参带 plan 结构化字段(或从 planPath 读不可行因为是 HTML)。
// 简单方案:plan_upgrade 入参加可选 planInput(完整 PlanCreateInput) + version(number,默认 2)。
// 若提供 planInput → 重生成 HTML + 写本地覆盖 + uploadFile(`plan_..._v${version}.html`, issueId) 追加新附件
// + commentOnIssue(issueId, `计划已升级到 v${version}(原因:${reason})· 新 HTML 附件已上传`)
// 保留现有 removeLabel(计划-已批准) + addLabel(计划-已升级/计划-草稿) + updateIssue(status:in_review)
```
**注**:plan_upgrade/session_handoff 重生成需要完整结构化输入。实现时给入参加可选 `planInput` 字段;调用方(skill)负责传。若没传 planInput 则只做 label/status 流转(降级,不重生成 HTML)+ comment 提示"需提供 planInput 才能重生成文档"。

- [ ] **Step 4: Run** → PASS

- [ ] **Step 5: Commit** `git commit -m "feat(plan_upgrade): 整篇重生成 HTML + 追加新版本附件 + comment"`

---

### Task 11: session_handoff 整篇重生成 + 追加附件

**Files:**
- Modify: `packages/local/src/tools/session_handoff.ts`
- Test: `packages/local/tests/tools/session_handoff.test.ts` (更新)

- [ ] **Step 1: 更新测试** — 保留现有 commentOnIssue 行为断言;新增:若提供 planInput,则重生成 `.html` 覆盖本地 + uploadFile 追加附件。

- [ ] **Step 2: Run** `pnpm --filter @tcmcp/local test tools/session_handoff -- --run` → FAIL

- [ ] **Step 3: 改 session_handoff.ts** — 保留现有 Current State comment 逻辑;补:入参加可选 `planInput`,若提供则 renderPlanHtml(含最新 currentState)→ 写本地覆盖 `.html` → uploadFile 追加附件。不提供则只 comment(现有行为不变 · 向后兼容)。

- [ ] **Step 4: Run** → PASS

- [ ] **Step 5: Commit** `git commit -m "feat(session_handoff): 可选重生成 HTML 附件(保留 comment)"`

---

### Task 12: 全量 build + test + skill 文案 + 真验证

**Files:**
- Modify: `team-context` 仓库 skills/tc-*/SKILL.md(md→html 文案)

- [ ] **Step 1: 全包 build + test**

Run: `cd /Users/feibo/feibo/team-context-mcp && pnpm -r build && pnpm -r test 2>&1 | tail -15`
Expected: build 5/5 Done · test 全绿

- [ ] **Step 2: skill 文案 md→html(team-context 仓库)**

```bash
cd /Users/feibo/feibo/team-context
grep -rln 'docs/plans/.*\.md\|docs/research/.*\.md\|cases/.*\.md\|\.md 文档\|md 产物' skills/
# 逐个把文档产物的 .md 描述改 .html · 加一句"自动上传到 issue · 可线上渲染"
git add skills/ && git commit -m "docs(skills): 文档产物 md→html 描述对齐" && git push
```

- [ ] **Step 3: push team-context-mcp**

```bash
cd /Users/feibo/feibo/team-context-mcp && git push
```
(push 触发 Zeabur 重建 tcmcp-remote;但这些是 local 工具,主要影响成员 tcmcp-local 重 build)

- [ ] **Step 4: 真验证(端到端 · 事后清理)**

```bash
# 重 build 本地 tcmcp-local
pnpm --filter @tcmcp/local build
# 调 plan_create(via MCP 或直接 node 脚本)建测试 issue
# 浏览器开 https://teamctx.actionow.ai/team-context/issues/<新issue>
# 确认:issue 有 HTML 附件 · iframe 渲染出方案A 衡线公文 · 字段都在
# 验完 cancel 测试 issue
```
Expected: issue 内 iframe 渲染衡线公文 HTML(米纸色 + 双线标题 + 字段卡片)· 本地 docs/plans/*.html 存在

- [ ] **Step 5: Commit (若 skill 还有遗漏)** — 已在 Step 2 commit。

---

## 完成标准(对照 spec §7)
- [ ] plan/research/case 工具产出 `.html` 本地 + issue HTML 附件 + 浏览器渲染
- [ ] uploadFile 失败本地仍写 + 返回 uploadError
- [ ] plan_upgrade 追加 v2 附件不替换
- [ ] pnpm -r build + test 全绿
- [ ] skill 文案 md→html
