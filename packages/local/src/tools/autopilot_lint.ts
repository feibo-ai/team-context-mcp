import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import matter from 'gray-matter';

// Use gray-matter alternative for YAML-only files? Use js-yaml.
// Simpler: parse via gray-matter by wrapping; or pull yaml package.
// For brevity here, use a minimal regex-based parser; in production use `yaml`.

export const autopilotLintInput = z.object({
  yamlPath: z.string(),
});

export type AutopilotLintInput = z.infer<typeof autopilotLintInput>;

export interface AutopilotLintOutput {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

interface AutopilotYaml {
  name?: string;
  description?: string;
  mode?: string;
  agent?: { name?: string };
  prompt?: string;
  trigger?: { cron?: string; timezone?: string };
  guardrails?: {
    forbidden_commands?: string[];
    forbidden_paths?: string[];
    max_budget_usd?: number;
    max_runtime_minutes?: number;
  };
}

const REQUIRED_FORBIDDEN_COMMANDS = ['git push', 'npm publish'];
const MAX_BUDGET_USD_HARD_CAP = 150;
const MIN_FORBIDDEN_COMMANDS = 5;

export async function autopilotLint(
  raw: AutopilotLintInput,
  _deps: unknown
): Promise<AutopilotLintOutput> {
  const input = autopilotLintInput.parse(raw);
  const yaml = await import('yaml');
  const text = await readFile(input.yamlPath, 'utf-8');
  const parsed = yaml.parse(text) as AutopilotYaml;

  const errors: string[] = [];
  const warnings: string[] = [];

  // Standard autopilot fields
  if (!parsed.name) errors.push('missing required field: name');
  if (!parsed.description) errors.push('missing required field: description');
  if (parsed.mode !== 'run_only' && parsed.mode !== 'create_issue') {
    errors.push(`invalid mode: ${parsed.mode} (must be run_only or create_issue)`);
  }
  if (!parsed.agent?.name) errors.push('missing required field: agent.name');
  if (!parsed.prompt) errors.push('missing required field: prompt');
  if (!parsed.trigger?.cron) errors.push('missing required field: trigger.cron');
  if (!parsed.trigger?.timezone) errors.push('missing required field: trigger.timezone');

  // Guardrails section (PB-04 hard requirement)
  const g = parsed.guardrails;
  if (!g) {
    errors.push('missing required section: guardrails (SOP PB-04 violation)');
    return { ok: false, errors, warnings };
  }
  if (!Array.isArray(g.forbidden_commands) || g.forbidden_commands.length < MIN_FORBIDDEN_COMMANDS) {
    errors.push(
      `guardrails.forbidden_commands must have ≥ ${MIN_FORBIDDEN_COMMANDS} entries (got ${g.forbidden_commands?.length ?? 0})`
    );
  } else {
    for (const required of REQUIRED_FORBIDDEN_COMMANDS) {
      const found = g.forbidden_commands.some((cmd) =>
        cmd.toLowerCase().includes(required.toLowerCase())
      );
      if (!found) {
        errors.push(`guardrails.forbidden_commands must include "${required}"`);
      }
    }
  }
  if (!Array.isArray(g.forbidden_paths) || g.forbidden_paths.length === 0) {
    errors.push('guardrails.forbidden_paths must have at least 1 entry');
  }
  if (typeof g.max_budget_usd !== 'number') {
    errors.push('guardrails.max_budget_usd must be a number');
  } else if (g.max_budget_usd > MAX_BUDGET_USD_HARD_CAP) {
    errors.push(
      `guardrails.max_budget_usd ${g.max_budget_usd} > ${MAX_BUDGET_USD_HARD_CAP} hard cap (SOP PB-04)`
    );
  } else if (g.max_budget_usd > 80) {
    warnings.push(`guardrails.max_budget_usd ${g.max_budget_usd} is in SOP PB-04 大批量 range — DRI 应明示批准`);
  }
  if (typeof g.max_runtime_minutes !== 'number' || g.max_runtime_minutes <= 0) {
    errors.push('guardrails.max_runtime_minutes must be a positive number');
  }

  return { ok: errors.length === 0, errors, warnings };
}
