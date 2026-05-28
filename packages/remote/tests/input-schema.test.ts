// Bug A (Plan 5 P1 smoke): tools that use z.union / z.discriminatedUnion /
// .refine() at the top level produced JSON Schema like { oneOf: [...] }
// without a top-level `type`, which strict MCP SDK clients reject. The fix
// in `zodToJsonSchema` forces `type:'object'` at the root. This test pins
// that contract for the 4 known offenders so a regression cannot land
// silently.
import { describe, it, expect } from 'vitest';
import { zodToJsonSchema } from '../src/server.js';
import { notifyTeamInput } from '../src/tools/notify_team.js';
import { dmMemberInput } from '../src/tools/dm_member.js';
import { burnoutCheckDistributeInput } from '../src/tools/burnout_check_distribute.js';
import { bettingTableCaptureInput } from '../src/tools/betting_table_capture.js';
import { shouldIUseAiInput } from '../src/tools/should_i_use_ai.js';

describe('zodToJsonSchema · root-level type:object (Bug A)', () => {
  it('notify_team (z.union) inputSchema has type:object at root', () => {
    const schema = zodToJsonSchema(notifyTeamInput) as Record<string, unknown>;
    expect(schema.type).toBe('object');
    // Sanity: union members still surface
    expect(Array.isArray(schema.oneOf)).toBe(true);
  });

  it('dm_member (.refine()) inputSchema has type:object at root', () => {
    const schema = zodToJsonSchema(dmMemberInput) as Record<string, unknown>;
    expect(schema.type).toBe('object');
  });

  it('burnout_check_distribute (z.discriminatedUnion) inputSchema has type:object', () => {
    const schema = zodToJsonSchema(burnoutCheckDistributeInput) as Record<
      string,
      unknown
    >;
    expect(schema.type).toBe('object');
    expect(Array.isArray(schema.oneOf)).toBe(true);
  });

  it('betting_table_capture (z.discriminatedUnion) inputSchema has type:object', () => {
    const schema = zodToJsonSchema(bettingTableCaptureInput) as Record<
      string,
      unknown
    >;
    expect(schema.type).toBe('object');
    expect(Array.isArray(schema.oneOf)).toBe(true);
  });

  it('plain ZodObject tools keep their existing type:object (no regression)', () => {
    const schema = zodToJsonSchema(shouldIUseAiInput) as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(schema.properties).toBeDefined();
  });
});
