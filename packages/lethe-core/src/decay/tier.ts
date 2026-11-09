// Tier thresholds: exact comparisons, no epsilon. Refs: REQ-DEC-2

import type { LetheConfig, Tier } from "../types.js";

export function tierOf(retention: number, cfg: LetheConfig): Tier {
  if (retention >= cfg.hotMin) return "hot";
  if (retention >= cfg.cryptMax) return "warm";
  return "crypt";
}
