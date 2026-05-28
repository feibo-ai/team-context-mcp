import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { autopilotLint } from '../../src/tools/autopilot_lint.js';

const here = dirname(fileURLToPath(import.meta.url));
const okPath = resolve(here, '../fixtures/autopilot-ok.yaml');
const badPath = resolve(here, '../fixtures/autopilot-missing-guardrails.yaml');

describe('autopilot_lint', () => {
  it('passes a well-formed autopilot YAML', async () => {
    const r = await autopilotLint({ yamlPath: okPath }, {});
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('fails on missing guardrails section', async () => {
    const r = await autopilotLint({ yamlPath: badPath }, {});
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /guardrails/i.test(e))).toBe(true);
  });

  it('fails when forbidden_commands lacks git push', async () => {
    // Test by writing a tmp YAML missing git push
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'al-'));
    const p = join(dir, 'bad.yaml');
    await writeFile(p, `name: x
description: x
mode: run_only
agent: { name: x }
prompt: x
trigger: { cron: "0 0 * * *", timezone: UTC }
guardrails:
  forbidden_commands: ["rm -rf", "psql drop", "echo a", "echo b", "echo c"]
  forbidden_paths: [".env"]
  max_budget_usd: 5
  max_runtime_minutes: 30
`);
    const r = await autopilotLint({ yamlPath: p }, {});
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /git push/i.test(e))).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it('fails when max_budget_usd > 150', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'al-'));
    const p = join(dir, 'expensive.yaml');
    await writeFile(p, `name: x
description: x
mode: run_only
agent: { name: x }
prompt: x
trigger: { cron: "0 0 * * *", timezone: UTC }
guardrails:
  forbidden_commands: ["git push", "git push --force", "npm publish", "rm -rf", "psql drop"]
  forbidden_paths: [".env"]
  max_budget_usd: 999
  max_runtime_minutes: 30
`);
    const r = await autopilotLint({ yamlPath: p }, {});
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /max_budget_usd/i.test(e))).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});
