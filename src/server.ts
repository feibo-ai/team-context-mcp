#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config.js';
import { MulticaClient } from './lib/multica.js';
import { planCreate, planCreateInput } from './tools/plan_create.js';
import { planRequestReview, planRequestReviewInput } from './tools/plan_request_review.js';
import { planApprove, planApproveInput } from './tools/plan_approve.js';
import { sessionHandoff, sessionHandoffInput } from './tools/session_handoff.js';
import { caseCreate, caseCreateInput } from './tools/case_create.js';
import { casePromoteRule, casePromoteRuleInput } from './tools/case_promote_rule.js';
import { skillLint, skillLintInput } from './tools/skill_lint.js';
import { monthlyHealthReport, monthlyHealthReportInput } from './tools/monthly_health_report.js';
import { planUpgrade, planUpgradeInput } from './tools/plan_upgrade.js';
import { projectKickoff, projectKickoffInput } from './tools/project_kickoff.js';
import { bettingTableCapture, bettingTableCaptureInput } from './tools/betting_table_capture.js';
import { burnoutCheckDistribute, burnoutCheckDistributeInput } from './tools/burnout_check_distribute.js';
import { autopilotLint, autopilotLintInput } from './tools/autopilot_lint.js';
import { caseReview, caseReviewInput } from './tools/case_review.js';
import { shouldIUseAi, shouldIUseAiInput } from './tools/should_i_use_ai.js';
import { codeReviewRequest, codeReviewRequestInput } from './tools/code_review_request.js';
import { researchCreate, researchCreateInput } from './tools/research_create.js';
import { z } from 'zod';

type ToolDef = {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  handler: (input: unknown, deps: { client: MulticaClient; teamContextRepo: string }) => Promise<unknown>;
};

const TOOLS: ToolDef[] = [
  { name: 'plan_create', description: 'Create a new plan markdown + multica plan-draft issue. SOP P-3 Phase 01 step 3.',
    schema: planCreateInput, handler: (i, d) => planCreate(i as any, d) },
  { name: 'plan_request_review', description: 'Label plan under-review + post reviewer prompt.',
    schema: planRequestReviewInput, handler: (i, d) => planRequestReview(i as any, d) },
  { name: 'plan_approve', description: 'Mark plan approved. The SOP non-negotiable #1 gate.',
    schema: planApproveInput, handler: (i, d) => planApprove(i as any, d) },
  { name: 'session_handoff', description: 'Pre-clear / restart handoff: commit WIP + update plan Current State.',
    schema: sessionHandoffInput, handler: (i, d) => sessionHandoff(i as any, d) },
  { name: 'case_create', description: 'Create debrief case file with 5 SOP sections. Non-negotiable #2.',
    schema: caseCreateInput, handler: (i, d) => caseCreate(i as any, d) },
  { name: 'case_promote_rule', description: 'Promote a case rule candidate to CLAUDE.md.',
    schema: casePromoteRuleInput, handler: (i, d) => casePromoteRule(i as any, d) },
  { name: 'skill_lint', description: 'Lint skills for token count / owner / stale review.',
    schema: skillLintInput, handler: (i, d) => skillLint(i as any, d) },
  { name: 'monthly_health_report', description: 'Generate SOP-aligned monthly health report.',
    schema: monthlyHealthReportInput, handler: (i, d) => monthlyHealthReport(i as any, d) },
  // ── Addendum v0.2: 4 more tools (B1-B4) ─────────────────────────────────
  { name: 'plan_upgrade', description: 'Snapshot current plan version and bump (v1.0 → v1.1). Re-labels for review.',
    schema: planUpgradeInput, handler: (i, d) => planUpgrade(i as any, d) },
  { name: 'project_kickoff', description: 'Phase 01 kickoff: create multica project + research/plan stubs + broadcast.',
    schema: projectKickoffInput, handler: (i, d) => projectKickoff(i as any, d) },
  { name: 'betting_table_capture', description: 'Friday betting-table issue (open / close / tally).',
    schema: bettingTableCaptureInput, handler: (i, d) => bettingTableCapture(i as any, d) },
  { name: 'burnout_check_distribute', description: 'Monthly anonymized burnout check (distribute / collect).',
    schema: burnoutCheckDistributeInput, handler: (i, d) => burnoutCheckDistribute(i as any, d) },
  // ── 5 red-line tools (B6-B10) ───────────────────────────────────────────
  { name: 'autopilot_lint', description: 'Lint autopilot YAML against PB-04 guardrails + budget cap.',
    schema: autopilotLintInput, handler: (i, d) => autopilotLint(i as any, d) },
  { name: 'case_review', description: 'Section 4 review gate. Refuses if section is trivial; signs and labels reviewed.',
    schema: caseReviewInput, handler: (i, d) => caseReview(i as any, d) },
  { name: 'should_i_use_ai', description: 'METR-aligned decision aid: use-ai / write-directly / borderline.',
    schema: shouldIUseAiInput, handler: (i, d) => shouldIUseAi(i as any, d) },
  { name: 'code_review_request', description: 'Block self-review (❌1). Assign a reviewer + code-review label.',
    schema: codeReviewRequestInput, handler: (i, d) => codeReviewRequest(i as any, d) },
  { name: 'research_create', description: 'RPI Research phase skeleton + multica research-labelled issue.',
    schema: researchCreateInput, handler: (i, d) => researchCreate(i as any, d) },
];

async function main() {
  const cfg = await loadConfig();
  const client = new MulticaClient(cfg.multica);

  const server = new Server({ name: 'team-context-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.schema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) throw new Error(`unknown tool: ${req.params.name}`);
    const parsed = tool.schema.parse(req.params.arguments);
    const result = await tool.handler(parsed, { client, teamContextRepo: cfg.teamContextRepo });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Minimal zod → JSON Schema (good enough for object schemas we use)
function zodToJsonSchema(s: z.ZodTypeAny): unknown {
  if (s instanceof z.ZodObject) {
    const shape = (s as any).shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      properties[k] = zodToJsonSchema(v);
      if (!v.isOptional()) required.push(k);
    }
    return { type: 'object', properties, required };
  }
  if (s instanceof z.ZodString) return { type: 'string' };
  if (s instanceof z.ZodBoolean) return { type: 'boolean' };
  if (s instanceof z.ZodNumber) return { type: 'number' };
  if (s instanceof z.ZodArray) return { type: 'array', items: zodToJsonSchema((s as any)._def.type) };
  if (s instanceof z.ZodEnum) return { type: 'string', enum: (s as any)._def.values };
  if (s instanceof z.ZodDefault) return zodToJsonSchema((s as any)._def.innerType);
  if (s instanceof z.ZodOptional) return zodToJsonSchema((s as any)._def.innerType);
  return {};
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
