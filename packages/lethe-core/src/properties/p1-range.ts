// P1: 0 < R <= 1 and R is finite for all valid inputs (incl. long idle gaps / underflow).
// Refs: REQ-DEC-1, INV-2

import fc from "fast-check";
import {
  burstyStateArb,
  engramStateArb,
  idleGapArb,
  longIdleStateArb,
  nowAfter,
} from "./arbitraries/state.arb.js";
import { computeDeltaC } from "../decay/delta.js";
import { computeRetention } from "../decay/retention.js";
import type { EngramState, LetheConfig } from "../types.js";

export const P1_ID = "P1";

function fail(msg: string): never {
  throw new Error(`${P1_ID} violated: ${msg}`);
}

function assertRange(r: number, ctx: string): void {
  if (!Number.isFinite(r)) fail(`R is not finite (${r}) for ${ctx}`);
  if (!(r > 0)) fail(`R = ${r} is not > 0 for ${ctx}`);
  if (!(r <= 1)) fail(`R = ${r} is not <= 1 for ${ctx}`);
}

/** States from the general, bursty and long-idle generators. */
function anyStateArb(cfg: LetheConfig): fc.Arbitrary<EngramState> {
  return fc.oneof(engramStateArb(cfg), burstyStateArb(cfg), longIdleStateArb(cfg));
}

function weightArb(cfg: LetheConfig): fc.Arbitrary<number> {
  return fc.constantFrom(cfg.wDefault, cfg.wSpec);
}

type Case = { readonly deltaC: number; readonly stability: number; readonly w: number };

/** Full pipeline: state + later "now" -> deltaC. */
function stateCase(cfg: LetheConfig): fc.Arbitrary<Case> {
  return anyStateArb(cfg)
    .chain((state) =>
      fc.record({ state: fc.constant(state), now: nowAfter(state), w: weightArb(cfg) }),
    )
    .map(({ state, now, w }) => ({
      deltaC: computeDeltaC(state, now.nowCommit, now.nowISO, cfg.alpha),
      stability: state.stability,
      w,
    }));
}

/** Raw deltaC (long idle gaps and an extreme 1e6) against any stability. */
function gapCase(cfg: LetheConfig): fc.Arbitrary<Case> {
  return fc.record({
    deltaC: fc.oneof(idleGapArb, fc.constant(1e6)),
    stability: fc.double({ min: cfg.sMin, max: cfg.sMax, noNaN: true, noDefaultInfinity: true }),
    w: weightArb(cfg),
  });
}

export function p1Range(cfg: LetheConfig) {
  return fc.property(fc.oneof(stateCase(cfg), gapCase(cfg)), ({ deltaC, stability, w }) => {
    const r = computeRetention(deltaC, stability, w, cfg.sMin);
    assertRange(r, `deltaC=${deltaC}, S=${stability}, W=${w}`);
  });
}
