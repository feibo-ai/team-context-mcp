#!/usr/bin/env node
// Plan 5 P1 smoke · invoke all 10 remote MCP tools via raw JSON-RPC over HTTP
// (the MCP SDK client strictly validates inputSchema.type which trips on
// z.union/discriminatedUnion tools — that's a separate P1 finding, not a
// smoke blocker). Each tool gets one synthetic call.
//
// PASS = HTTP 200 + jsonrpc result (even if isError=true from downstream
//        feishu 400 — proves the MCP path dispatched correctly).
// FAIL = transport error or jsonrpc error.

const URL = process.env.TCMCP_URL || 'http://localhost:8443/mcp';
const TOKEN = process.env.TCMCP_TOKEN;
if (!TOKEN) { console.error('Set TCMCP_TOKEN'); process.exit(2); }

async function init() {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '1.0' } } }),
  });
  if (!res.ok) throw new Error(`init HTTP ${res.status}`);
  const sid = res.headers.get('mcp-session-id');
  await res.text();
  await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN}`, ...(sid ? { 'mcp-session-id': sid } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
  }).then(r => r.text());
  return sid;
}

let RPC_ID = 100;
async function rpc(sid, method, params) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN}`, ...(sid ? { 'mcp-session-id': sid } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: RPC_ID++, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const dataLine = text.split('\n').find(l => l.startsWith('data: '));
  return dataLine ? JSON.parse(dataLine.slice(6)) : JSON.parse(text);
}

const CASES = [
  { name: 'should_i_use_ai', args: { taskDescription: 'add a small unit test for utility fn', devExperienceYears: 4, isFamiliarCodebase: true, taskEstimateMinutes: 30 } },
  { name: 'search_chat', args: { query: 'AI MIQ' } },
  { name: 'notify_team', args: { text: '[P1 smoke] Plan 5 follow-up · proves 10 tool registrations work' } },
  { name: 'dm_member', args: { email: 'autopilot-bot@aimiq.test', text: '[P1 smoke] dm self test' } },
  { name: 'read_member_dm', args: { email: 'autopilot-bot@aimiq.test', sinceISO: new Date(Date.now() - 86400_000).toISOString() } },
  // archive_to_wiki: pass dummy wiki space/parent to bypass the "(config or args) required" guard.
  // Expected: tool dispatches → docImportMarkdown runs against feishu → fails at feishu level
  // (no perms / bad token) → PATH-OK. This proves the new P0 impl path executes.
  { name: 'archive_to_wiki', args: { markdownPath: '/tmp/smoke-wiki-content.md', title: '[P1 smoke] Plan 5 archive', wikiSpaceId: 'wikcnSmokeDummy123', parentNodeToken: 'parentSmokeDummy' } },
  { name: 'burnout_check_distribute', args: { action: 'distribute', teamEmails: ['autopilot-bot@aimiq.test'], month: '2026-05' } },
  { name: 'code_review_request', args: { implementerAgentId: '1a68e07e-1af8-4f23-982d-ec6354a84226', reviewerAgentId: '670f3afb-abaf-4f68-ac23-c2a63782555d', commitHash: '79dc83e', context: '[P1 smoke] code review request flow test · short context exceeds 10 chars' } },
  { name: 'plan_request_review', args: { multicaIssueId: 'smoke-issue-id', reviewer: 'autopilot-bot@aimiq.test' } },
  { name: 'betting_table_capture', args: { action: 'open', weekOf: '2026-06-01', proposals: [{ id: 'p1', title: 'Smoke proposal A', proposer: 'autopilot-bot@aimiq.test' }] } },
];

const sid = await init();
console.log(`✓ initialized · sid=${sid ?? '(none)'}\n`);

const results = [];
for (const c of CASES) {
  try {
    const r = await rpc(sid, 'tools/call', { name: c.name, arguments: c.args });
    if (r.error) {
      results.push({ name: c.name, status: 'JSONRPC-ERR', detail: JSON.stringify(r.error).slice(0, 200) });
    } else if (r.result?.isError) {
      const text = r.result.content?.[0]?.text?.slice(0, 200) ?? JSON.stringify(r.result).slice(0, 200);
      results.push({ name: c.name, status: 'PATH-OK', detail: text });
    } else {
      const text = r.result?.content?.[0]?.text?.slice(0, 200) ?? JSON.stringify(r.result).slice(0, 200);
      results.push({ name: c.name, status: 'OK', detail: text });
    }
  } catch (e) {
    results.push({ name: c.name, status: 'FAIL', detail: String(e).slice(0, 200) });
  }
}

console.log('=== Smoke Results · 10 remote tools ===');
for (const r of results) {
  console.log(`[${r.status.padEnd(12)}] ${r.name.padEnd(28)} ${r.detail.slice(0, 150).replace(/\n/g, ' ')}`);
}
const fails = results.filter(r => r.status === 'FAIL' || r.status === 'JSONRPC-ERR');
const oks = results.filter(r => r.status === 'OK' || r.status === 'PATH-OK');
console.log(`\nTotal: ${results.length} · OK+PATH-OK: ${oks.length} · FAIL+JSONRPC-ERR: ${fails.length}`);
process.exit(fails.length > 0 ? 1 : 0);
