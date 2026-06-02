// Bug A / A′ + Anthropic-API schema rule: tools that use z.union /
// z.discriminatedUnion at the top level produced JSON Schema like
// { oneOf: [...] } WITHOUT a top-level `type` (Bug A) and without top-level
// `properties` (Bug A′ — strict clients see "no params" and strip args). The
// walker now (a) forces type:'object' at root, (b) merges every branch's
// properties up to the root, and (c) emits NO top-level `oneOf` — the Anthropic
// tool API rejects oneOf/anyOf/allOf at the root of input_schema (400), which
// broke every Claude Code request once these tools loaded. Runtime zod `.parse()`
// still enforces the union. These tests pin all three halves for the offenders.
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
  it('notify_team (z.union) exposes text+card at root with NO top-level oneOf', () => {
    const schema = zodToJsonSchema(notifyTeamInput) as Record<string, unknown>;
    expect(schema.type).toBe('object');
    // Anthropic API rejects oneOf/anyOf/allOf at the root → must be absent.
    expect(schema.oneOf).toBeUndefined();
    expect(schema.anyOf).toBeUndefined();
    expect(schema.allOf).toBeUndefined();
    // Bug A′: the union branch params must still surface at the TOP level, else
    // a strict client sees an empty-param tool and strips text/card.
    expect(propKeys(schema)).toEqual(expect.arrayContaining(['text', 'card']));
  });

  it('dm_member (.refine()) inputSchema has type:object + non-empty properties', () => {
    const schema = zodToJsonSchema(dmMemberInput) as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(propKeys(schema).length).toBeGreaterThan(0);
  });

  it('burnout_check_distribute (z.discriminatedUnion) exposes action+fields, no top-level oneOf', () => {
    const schema = zodToJsonSchema(burnoutCheckDistributeInput) as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(schema.oneOf).toBeUndefined();
    expect(propKeys(schema)).toContain('action');
    expect(propKeys(schema).length).toBeGreaterThan(1);
  });

  it('betting_table_capture (z.discriminatedUnion) exposes action+fields, no top-level oneOf', () => {
    const schema = zodToJsonSchema(bettingTableCaptureInput) as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(schema.oneOf).toBeUndefined();
    expect(propKeys(schema)).toContain('action');
    expect(propKeys(schema).length).toBeGreaterThan(1);
  });

  it('plain ZodObject tools keep their properties (no regression)', () => {
    const schema = zodToJsonSchema(shouldIUseAiInput) as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(propKeys(schema).length).toBeGreaterThan(0);
  });
});
