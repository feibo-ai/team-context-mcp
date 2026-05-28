import { z } from 'zod';

export const shouldIUseAiInput = z.object({
  taskDescription: z.string().min(5),
  devExperienceYears: z.number().min(0),
  isFamiliarCodebase: z.boolean(),
  taskEstimateMinutes: z.number().min(1),
});

export type ShouldIUseAiInput = z.infer<typeof shouldIUseAiInput>;

export type Recommendation = 'write-directly' | 'use-ai' | 'borderline';

export interface ShouldIUseAiOutput {
  recommendation: Recommendation;
  reason: string;
  factors: Array<{ name: string; signal: 'pro-ai' | 'pro-direct' | 'neutral'; note: string }>;
}

export async function shouldIUseAi(
  raw: ShouldIUseAiInput,
  _deps: unknown
): Promise<ShouldIUseAiOutput> {
  const input = shouldIUseAiInput.parse(raw);
  const factors: ShouldIUseAiOutput['factors'] = [];

  // Factor 1: experience
  if (input.devExperienceYears >= 5) {
    factors.push({ name: 'experience', signal: 'pro-direct', note: `${input.devExperienceYears}y experienced` });
  } else if (input.devExperienceYears < 3) {
    factors.push({ name: 'experience', signal: 'pro-ai', note: `${input.devExperienceYears}y dev — AI协助有价值` });
  } else {
    factors.push({ name: 'experience', signal: 'neutral', note: `${input.devExperienceYears}y mid-level` });
  }

  // Factor 2: codebase familiarity
  if (input.isFamiliarCodebase) {
    factors.push({ name: 'codebase', signal: 'pro-direct', note: 'familiar codebase — METR ❌8 trigger zone' });
  } else {
    factors.push({ name: 'codebase', signal: 'pro-ai', note: 'unfamiliar codebase — AI 协助 explore + 减少冷启动' });
  }

  // Factor 3: task size
  if (input.taskEstimateMinutes <= 60) {
    factors.push({ name: 'task_size', signal: 'pro-direct', note: `${input.taskEstimateMinutes}min — 短任务 AI 启动开销大` });
  } else if (input.taskEstimateMinutes >= 180) {
    factors.push({ name: 'task_size', signal: 'pro-ai', note: `${input.taskEstimateMinutes}min — 长任务 AI 协助有杠杆` });
  } else {
    factors.push({ name: 'task_size', signal: 'neutral', note: `${input.taskEstimateMinutes}min — mid size` });
  }

  // Aggregate
  const proAi = factors.filter((f) => f.signal === 'pro-ai').length;
  const proDirect = factors.filter((f) => f.signal === 'pro-direct').length;

  // SOP ❌8 red-line trigger: experienced + familiar + short = write directly
  if (
    input.devExperienceYears >= 5 &&
    input.isFamiliarCodebase &&
    input.taskEstimateMinutes <= 60
  ) {
    return {
      recommendation: 'write-directly',
      reason: 'SOP ❌8 红线触发: 经验丰富 + 熟悉 codebase + 短任务 — METR 数据下用 AI 反慢 19%. 直接写更快。',
      factors,
    };
  }

  // Junior dominates: < 3y experience → AI assistance is always net positive,
  // unless the red-line above already fired (it didn't, because that needs ≥ 5y).
  if (input.devExperienceYears < 3) {
    return {
      recommendation: 'use-ai',
      reason: '初级工程师 — AI 辅助在熟练之前都有杠杆',
      factors,
    };
  }

  // All three factors pro-direct: confident skip.
  if (proDirect === 3) {
    return {
      recommendation: 'write-directly',
      reason: '三个因子都指向直接写更快',
      factors,
    };
  }

  // Two-plus pro-ai signals (mixed allowed): clear win.
  if (proAi >= 2) {
    return {
      recommendation: 'use-ai',
      reason: '多个因子指向用 AI 有杠杆 (unfamiliar / 长任务)',
      factors,
    };
  }

  return {
    recommendation: 'borderline',
    reason: '混合信号 — DRI / 你自己根据上下文判断。建议先试 15 分钟 AI，无进展立即切直接写。',
    factors,
  };
}
