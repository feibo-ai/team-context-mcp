// Bug A / A′ (Plan 5 P1 + schema audit): tools that use z.union /
// z.discriminatedUnion at the top level produced JSON Schema like
// { oneOf: [...] } WITHOUT a top-level `type` (Bug A — strict clients reject)
// AND without top-level `properties` (Bug A′ — strict clients see "no params"
// and strip the caller's args → server gets undefined → fails). The walker now
// (a) forces type:'object' at root and (b) merges every union branch's
// properties up to the root, keeping `oneOf` for the mutual-exclusivity
// semantics. These tests pin BOTH halves of the contract for the 3 union
// offenders so a regression cannot land silently.
import { describe, it, expect } from 'vitest';
import { zodToJsonSchema } from '../src/server.js';
import { notifyTeamInput } from '../src/tools/notify_team.js';
import { dmMemberInput } from '../src/tools/dm_member.js';
import { burnoutCheckDistributeInput } from '../src/tools/burnout_check_distribute.js';
import { bettingTableCaptureInput } from '../src/tools/betting_table_capture.js';
import { shouldIUseAiInput } from '../src/tools/should_i_use_ai.js';

function propKeys(schema: Record<string, unknown>): string[] {
  return Object.keys((schema.properties ?? {}) as Record<string, unknown>);
}

describe('zodToJsonSchema · root type:object + non-empty properties (Bug A/A′)', () => {
  it('notify_team (z.union) exposes text+card at root and keeps oneOf', () => {
    const schema = zodToJsonSchema(notifyTeamInput) as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(Array.isArray(schema.oneOf)).toBe(true);
    // Bug A′: the union branch params must surface at the TOP level, else a
    // strict client sees an empty-param tool and strips text/card.
    expect(propKeys(schema)).toEqual(expect.arrayContaining(['text', 'card']));
  });

  it('dm_member (.refine()) inputSchema has type:object + non-empty properties', () => {
    const schema = zodToJsonSchema(dmMemberInput) as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(propKeys(schema).length).toBeGreaterThan(0);
  });

  it('burnout_check_distribute (z.discriminatedUnion) exposes action+fields at root', () => {
    const schema = zodToJsonSchema(burnoutCheckDistributeInput) as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(Array.isArray(schema.oneOf)).toBe(true);
    expect(propKeys(schema)).toContain('action');
    expect(propKeys(schema).length).toBeGreaterThan(1);
  });

  it('betting_table_capture (z.discriminatedUnion) exposes action+fields at root', () => {
    const schema = zodToJsonSchema(bettingTableCaptureInput) as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(Array.isArray(schema.oneOf)).toBe(true);
    expect(propKeys(schema)).toContain('action');
    expect(propKeys(schema).length).toBeGreaterThan(1);
  });

  it('plain ZodObject tools keep their properties (no regression)', () => {
    const schema = zodToJsonSchema(shouldIUseAiInput) as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(propKeys(schema).length).toBeGreaterThan(0);
  });
});
