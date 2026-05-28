import { describe, it, expect } from 'vitest';

describe('remote transport', () => {
  it('exports startServer fn', async () => {
    const mod = await import('../src/server.js');
    expect(typeof mod.startServer).toBe('function');
  });
  // Full HTTP transport e2e in Task M-24
});
