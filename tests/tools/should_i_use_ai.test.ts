import { describe, it, expect } from 'vitest';
import { shouldIUseAi } from '../../src/tools/should_i_use_ai.js';

describe('should_i_use_ai', () => {
  it('recommends "write directly" for experienced dev + familiar code + short task', async () => {
    const r = await shouldIUseAi({
      taskDescription: 'rename a function and update 3 callers',
      devExperienceYears: 8,
      isFamiliarCodebase: true,
      taskEstimateMinutes: 30,
    }, {});
    expect(r.recommendation).toBe('write-directly');
    expect(r.reason).toMatch(/METR/i);
  });

  it('recommends "use ai" for new/unfamiliar codebase', async () => {
    const r = await shouldIUseAi({
      taskDescription: 'integrate a new payment provider SDK we have never used',
      devExperienceYears: 8,
      isFamiliarCodebase: false,
      taskEstimateMinutes: 240,
    }, {});
    expect(r.recommendation).toBe('use-ai');
  });

  it('recommends "use ai" for junior dev even on familiar code', async () => {
    const r = await shouldIUseAi({
      taskDescription: 'add a small feature',
      devExperienceYears: 1,
      isFamiliarCodebase: true,
      taskEstimateMinutes: 60,
    }, {});
    expect(r.recommendation).toBe('use-ai');
  });

  it('returns "borderline" with factor breakdown for mixed signals', async () => {
    const r = await shouldIUseAi({
      taskDescription: 'medium task in semi-familiar area',
      devExperienceYears: 5,
      isFamiliarCodebase: true,
      taskEstimateMinutes: 120,
    }, {});
    expect(r.recommendation).toBe('borderline');
    expect(r.factors.length).toBeGreaterThan(0);
  });
});
