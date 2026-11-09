// Weight / protection resolution for decay
// Refs: REQ-DEC-4, REQ-DEC-7

import type { EngramNode, LetheConfig, SpecInvariant } from "../types.js";

export interface WeightResult {
  readonly W: number;
  readonly isProtected: boolean;
  readonly floor: number;
}

/**
 * Pinned or linked to an active spec => W = wSpec (applied once), floor = specFloor.
 * Otherwise W = wDefault, floor = 0. Inactive specs never protect.
 */
export function computeWeight(
  node: EngramNode,
  specs: readonly SpecInvariant[],
  cfg: LetheConfig,
): WeightResult {
  const isProtected =
    node.pinned === true ||
    specs.some((s) => s.active && node.specLinks.includes(s.specName));
  return isProtected
    ? { W: cfg.wSpec, isProtected: true, floor: cfg.specFloor }
    : { W: cfg.wDefault, isProtected: false, floor: 0 };
}
