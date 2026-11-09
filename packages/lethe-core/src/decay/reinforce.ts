// Reinforcement: grow stability on a ledger event
// Refs: REQ-DEC-3, P3

import type { EngramState, LedgerEvent, LetheConfig } from "../types.js";

/**
 * Returns a NEW state with boosted stability. Never mutates `state`.
 *
 * newS = min(max(S, sMin) * (1 + beta), sMax), then clamped so it never
 * drops below the incoming S (P3). This matters for out-of-contract input
 * where S > sMax: stability is kept as-is rather than lowered.
 *
 * `lastReinforcedCommit` keeps the later of the stored and event commits,
 * so an out-of-order (older) event cannot move the reference point
 * backwards and inflate effective age (deltaC). `lastReinforcedAt` likewise
 * keeps the later of the stored and event timestamps.
 */
export function reinforce(
  state: EngramState,
  ev: LedgerEvent,
  cfg: LetheConfig,
): EngramState {
  const boosted = Math.min(Math.max(state.stability, cfg.sMin) * (1 + cfg.beta), cfg.sMax);
  return {
    id: state.id,
    stability: Math.max(state.stability, boosted),
    lastReinforcedCommit: Math.max(state.lastReinforcedCommit, ev.commit),
    lastReinforcedAt: laterIso(state.lastReinforcedAt, ev.at),
    reinforcements: state.reinforcements + 1,
  };
}

/**
 * Later of two ISO timestamps (ties and an unparsable stored value go to the
 * event). An unparsable event timestamp keeps the stored one. Mirrors the
 * commit max so deltaC can never grow from reinforcing (P3).
 */
function laterIso(stored: string, eventAt: string): string {
  const s = Date.parse(stored);
  const e = Date.parse(eventAt);
  if (Number.isNaN(e)) return stored;
  if (Number.isNaN(s)) return eventAt;
  return s > e ? stored : eventAt;
}
