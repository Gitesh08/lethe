/**
 * Retention R = exp(-Δc / (S_eff · W)), with S_eff = max(S, sMin).
 * REQ-DEC-1, INV-2.
 *
 * Edge handling (deterministic, no epsilon comparisons):
 * - Δc < 0 is treated as 0, so R never exceeds 1.
 * - For very large Δc, Math.exp underflows to exactly 0, violating 0 < R.
 *   The result is floored at Number.MIN_VALUE (smallest positive double),
 *   so R stays strictly positive and monotonic non-increasing in Δc.
 */
export function computeRetention(
  deltaC: number,
  S: number,
  W: number,
  sMin: number,
): number {
  const sEff = Math.max(S, sMin);
  const dc = Math.max(deltaC, 0);
  return Math.max(Math.exp(-dc / (sEff * W)), Number.MIN_VALUE);
}
