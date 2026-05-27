/**
 * Estimate tokens from text using word-count × 1.3 heuristic.
 * Matches the CI lint formula used in team-context repo.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.floor((words * 13) / 10);
}
