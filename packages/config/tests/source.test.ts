// packages/config/tests/source.test.ts
import { describe, it, expect } from 'vitest';
import type { ConfigSource } from '../src/source.js';

describe('ConfigSource interface', () => {
  it('compiles', () => {
    const _stub: ConfigSource = {
      get: () => undefined,
      getSecret: async () => undefined,
      version: () => 0,
      onChange: () => () => {},
    };
    expect(typeof _stub.get).toBe('function');
  });
});
