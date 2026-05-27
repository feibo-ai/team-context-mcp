import { describe, it, expect } from 'vitest';
import { estimateTokens } from '../../src/lib/tokens.js';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates ~1.3 tokens per word', () => {
    // 10 words → ~13 tokens
    const text = 'one two three four five six seven eight nine ten';
    expect(estimateTokens(text)).toBe(13);
  });

  it('handles multiline', () => {
    const text = 'one two\nthree four\nfive six';
    expect(estimateTokens(text)).toBe(7); // 6 words * 1.3 = 7.8 → 7 (floor)
  });
});
