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
