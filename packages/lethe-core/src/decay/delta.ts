import type { EngramState } from "../types.js";

const MS_PER_DAY = 86_400_000;

/**
 * Effective elapsed "decay clock" since last reinforcement:
 * commits elapsed + alpha * days elapsed. Both terms are clamped at >= 0.
 *
 * Totality: if either ISO date fails to parse (NaN), daysSince is treated
 * as 0, so the result is never NaN. `new Date(iso)` with an argument is pure.
 */
export function computeDeltaC(
  state: EngramState,
  nowCommit: number,
  nowISO: string,
  alpha: number,
): number {
  const commitsSince = Math.max(0, nowCommit - state.lastReinforcedCommit);
  const elapsedMs = new Date(nowISO).getTime() - new Date(state.lastReinforcedAt).getTime();
  const daysSince = Number.isNaN(elapsedMs) ? 0 : Math.max(0, elapsedMs / MS_PER_DAY);
  return commitsSince + alpha * daysSince;
}
