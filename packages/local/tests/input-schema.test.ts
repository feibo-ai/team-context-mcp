// Pins the local walker's union contract (parity with @tcmcp/remote).
// No local tool uses a top-level union today; this guards against a future one
// silently shipping with empty root `properties` (strict MCP clients read as
// "takes no params") OR with a top-level `oneOf` (the Anthropic tool API rejects
// oneOf/anyOf/allOf at the root of input_schema → 400 on every Claude Code call).
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from '../src/server.js';

function propKeys(schema: Record<string, unknown>): string[] {
  return Object.keys((schema.properties ?? {}) as Record<string, unknown>);
}

describe('local zodToJsonSchema · union merges branch properties to root', () => {
  it('z.union exposes both branches at root with NO top-level oneOf', () => {
    const schema = zodToJsonSchema(
      z.union([z.object({ text: z.string() }), z.object({ card: z.string() })]),
    ) as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(schema.oneOf).toBeUndefined();
    expect(propKeys(schema)).toEqual(expect.arrayContaining(['text', 'card']));
  });

  it('z.discriminatedUnion exposes discriminator + branch fields, no top-level oneOf', () => {
    const schema = zodToJsonSchema(
      z.discriminatedUnion('action', [
        z.object({ action: z.literal('a'), x: z.string() }),
        z.object({ action: z.literal('b'), y: z.string() }),
      ]),
    ) as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(schema.oneOf).toBeUndefined();
    expect(propKeys(schema)).toEqual(expect.arrayContaining(['action', 'x', 'y']));
  });

  it('plain ZodObject is unchanged (type:object + properties)', () => {
    const schema = zodToJsonSchema(z.object({ a: z.string() })) as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(propKeys(schema)).toContain('a');
  });
});
