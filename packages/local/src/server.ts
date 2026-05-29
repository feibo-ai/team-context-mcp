#!/usr/bin/env node
// @tcmcp/local — stdio MCP server for the 12 local-only SOP workflow tools.
//
// Local tools are file-system + git heavy (plan/case/research/skill_lint etc).
// They run in the developer's checkout where files live; no remote transport.
// Mirrors the old root src/server.ts but registers only the 12 tools that
// stayed local. The 5 remote-capable tools moved to @tcmcp/remote.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MulticaClient } from '@tcmcp/shared';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { planCreate, planCreateInput } from './tools/plan_create.js';
import { planApprove, planApproveInput } from './tools/plan_approve.js';
import { planUpgrade, planUpgradeInput } from './tools/plan_upgrade.js';
import { caseCreate, caseCreateInput } from './tools/case_create.js';
import { caseReview, caseReviewInput } from './tools/case_review.js';
import { casePromoteRule, casePromoteRuleInput } from './tools/case_promote_rule.js';
import { sessionHandoff, sessionHandoffInput } from './tools/session_handoff.js';
import { projectKickoff, projectKickoffInput } from './tools/project_kickoff.js';
import { researchCreate, researchCreateInput } from './tools/research_create.js';
import { skillLint, skillLintInput } from './tools/skill_lint.js';
import { monthlyHealthReport, monthlyHealthReportInput } from './tools/monthly_health_report.js';
import { autopilotLint, autopilotLintInput } from './tools/autopilot_lint.js';

type ToolDef = {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  handler: (
    input: unknown,
    deps: { client: MulticaClient; teamContextRepo: string },
  ) => Promise<unknown>;
};

const TOOLS: ToolDef[] = [
  {
    name: 'plan_create',
    description:
      'Create a new plan markdown + multica 计划-草稿 issue. SOP P-3 Phase 01 step 3.',
    schema: planCreateInput,
    handler: (i, d) => planCreate(i as z.infer<typeof planCreateInput>, d),
  },
  {
    name: 'plan_approve',
    description: 'Mark plan approved. The SOP non-negotiable #1 gate.',
    schema: planApproveInput,
    handler: (i, d) => planApprove(i as z.infer<typeof planApproveInput>, d),
  },
  {
    name: 'plan_upgrade',
    description:
      'Snapshot current plan version and bump (v1.0 → v1.1). Re-labels for review.',
    schema: planUpgradeInput,
    handler: (i, d) => planUpgrade(i as z.infer<typeof planUpgradeInput>, d),
  },
  {
    name: 'case_create',
    description:
      'Create debrief case file with 5 SOP sections. Non-negotiable #2.',
    schema: caseCreateInput,
    handler: (i, d) => caseCreate(i as z.infer<typeof caseCreateInput>, d),
  },
  {
    name: 'case_review',
    description:
      'Section 4 review gate. Refuses if section is trivial; signs and labels reviewed.',
    schema: caseReviewInput,
    handler: (i, d) => caseReview(i as z.infer<typeof caseReviewInput>, d),
  },
  {
    name: 'case_promote_rule',
    description: 'Promote a case rule candidate to CLAUDE.md.',
    schema: casePromoteRuleInput,
    handler: (i, d) =>
      casePromoteRule(i as z.infer<typeof casePromoteRuleInput>, d),
  },
  {
    name: 'session_handoff',
    description:
      'Pre-clear / restart handoff: commit WIP + update plan Current State.',
    schema: sessionHandoffInput,
    handler: (i, d) =>
      sessionHandoff(i as z.infer<typeof sessionHandoffInput>, d),
  },
  {
    name: 'project_kickoff',
    description:
      'Scaffold Phase 01: creates project + research issue + plan issue + empty file stubs. Does NOT run deep research and does NOT send broadcast — chain rpi-research (Step 2) and notify_team (Step 1/6) separately.',
    schema: projectKickoffInput,
    handler: (i, d) =>
      projectKickoff(i as z.infer<typeof projectKickoffInput>, d),
  },
  {
    name: 'research_create',
    description: 'RPI Research phase skeleton + multica 研究 issue.',
    schema: researchCreateInput,
    handler: (i, d) =>
      researchCreate(i as z.infer<typeof researchCreateInput>, d),
  },
  {
    name: 'skill_lint',
    description: 'Lint skills for token count / owner / stale review.',
    schema: skillLintInput,
    handler: (i, d) => skillLint(i as z.infer<typeof skillLintInput>, d),
  },
  {
    name: 'monthly_health_report',
    description: 'Generate SOP-aligned monthly health report.',
    schema: monthlyHealthReportInput,
    handler: (i, d) =>
      monthlyHealthReport(i as z.infer<typeof monthlyHealthReportInput>, d),
  },
  {
    name: 'autopilot_lint',
    description: 'Lint autopilot YAML against PB-04 guardrails + budget cap.',
    schema: autopilotLintInput,
    handler: (i, d) => autopilotLint(i as z.infer<typeof autopilotLintInput>, d),
  },
];

async function main(): Promise<void> {
  const cfg = await loadConfig();
  const client = new MulticaClient(cfg.multica);

  const server = new Server(
    { name: 'team-context-mcp-local', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.schema) as Record<string, unknown>,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) throw new Error(`unknown tool: ${req.params.name}`);
    const parsed = tool.schema.parse(req.params.arguments);
    const result = await tool.handler(parsed, {
      client,
      teamContextRepo: cfg.teamContextRepo,
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Minimal zod → JSON Schema. Mirrors @tcmcp/remote's walker. Exported so tests
// can pin the union contract (Bug A′) without spawning the stdio server.

/**
 * Union / discriminatedUnion → keep `oneOf` but merge each branch's properties
 * to the root, else strict MCP clients see a "no-params" tool and strip args
 * (Bug A′). No local tool uses a top-level union today; this keeps parity with
 * the remote walker so a future one can't silently ship broken. required left
 * empty (per-branch / either-or).
 */
function mergeUnion(branches: unknown[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const b of branches) {
    const bp = (b as { properties?: Record<string, unknown> }).properties;
    if (bp) Object.assign(properties, bp);
  }
  return { type: 'object', properties, oneOf: branches };
}

export function zodToJsonSchema(s: z.ZodTypeAny): unknown {
  if (s instanceof z.ZodObject) {
    const shape = (s as z.ZodObject<z.ZodRawShape>).shape;
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
  if (s instanceof z.ZodArray)
    return {
      type: 'array',
      items: zodToJsonSchema((s as z.ZodArray<z.ZodTypeAny>)._def.type),
    };
  if (s instanceof z.ZodEnum)
    return { type: 'string', enum: (s as z.ZodEnum<[string, ...string[]]>)._def.values };
  if (s instanceof z.ZodLiteral)
    return { const: (s as z.ZodLiteral<unknown>)._def.value };
  if (s instanceof z.ZodDiscriminatedUnion) {
    const opts = (s as z.ZodDiscriminatedUnion<string, z.ZodObject<z.ZodRawShape>[]>)
      .options;
    const arr: z.ZodTypeAny[] = opts instanceof Map ? Array.from(opts.values()) : opts;
    return mergeUnion(arr.map((o) => zodToJsonSchema(o)));
  }
  if (s instanceof z.ZodUnion) {
    const opts = (s as z.ZodUnion<readonly [z.ZodTypeAny, ...z.ZodTypeAny[]]>)._def.options;
    return mergeUnion(opts.map((o: z.ZodTypeAny) => zodToJsonSchema(o)));
  }
  if (s instanceof z.ZodRecord) {
    return {
      type: 'object',
      additionalProperties: zodToJsonSchema(
        (s as z.ZodRecord<z.ZodTypeAny, z.ZodTypeAny>)._def.valueType,
      ),
    };
  }
  if (s instanceof z.ZodEffects) {
    return zodToJsonSchema((s as z.ZodEffects<z.ZodTypeAny>)._def.schema);
  }
  if (s instanceof z.ZodDefault)
    return zodToJsonSchema((s as z.ZodDefault<z.ZodTypeAny>)._def.innerType);
  if (s instanceof z.ZodOptional)
    return zodToJsonSchema((s as z.ZodOptional<z.ZodTypeAny>)._def.innerType);
  return {};
}

// Only run main() when executed directly (not when imported by tests) —
// mirrors @tcmcp/remote/src/server.ts.
if (import.meta.url === `file://${process.argv[1] ?? ''}`.replace(/\\/g, '/')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
