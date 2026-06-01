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
