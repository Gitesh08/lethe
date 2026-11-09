// P2: without reinforcement, dc1 <= dc2 implies R(dc1) >= R(dc2) (exact >=).
// Also checked through the real time inputs (computeDeltaC).
// Refs: REQ-DEC-2, INV-2, REQ-PBT-1

import fc from "fast-check";
import {
  burstyStateArb,
  engramStateArb,
  longIdleStateArb,
} from "./arbitraries/state.arb.js";
import { computeDeltaC } from "../decay/delta.js";
import { computeRetention } from "../decay/retention.js";
import type { EngramState, LetheConfig } from "../types.js";

export const P2_ID = "P2";

const MS_LO = Date.UTC(2025, 0, 1);
const MS_HI = Date.UTC(2030, 0, 1);
const MAX_MS_STEP = 315_360_000_000; // ~10 years

function fail(msg: string): never {
  throw new Error(`${P2_ID} violated: ${msg}`);
}

const ageArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 3, arbitrary: fc.double({ min: 0, max: 1e7, noNaN: true, noDefaultInfinity: true }) },
  { weight: 2, arbitrary: fc.integer({ min: 500, max: 100_000 }) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 1000 }) },
  { weight: 1, arbitrary: fc.constantFrom(0, 1e7) },
);

interface AgeCase {
  readonly state: EngramState;
  readonly w: number;
  readonly dc1: number;
  readonly dc2: number;
}

interface TimeCase {
  readonly state: EngramState;
  readonly w: number;
  readonly commit1: number;
  readonly commit2: number;
  readonly ms1: number;
  readonly ms2: number;
}

function stateArb(cfg: LetheConfig): fc.Arbitrary<EngramState> {
  return fc.oneof(engramStateArb(cfg), burstyStateArb(cfg), longIdleStateArb(cfg));
}

function weightArb(cfg: LetheConfig): fc.Arbitrary<number> {
  return fc.constantFrom(cfg.wDefault, cfg.wSpec);
}

function ageCaseArb(cfg: LetheConfig): fc.Arbitrary<AgeCase> {
  return fc
    .tuple(stateArb(cfg), weightArb(cfg), ageArb, ageArb)
    .map(([state, w, dc1, inc]) => ({ state, w, dc1, dc2: dc1 + inc }));
}

function timeCaseArb(cfg: LetheConfig): fc.Arbitrary<TimeCase> {
  return fc
    .tuple(
      stateArb(cfg),
      weightArb(cfg),
      fc.integer({ min: 0, max: 200_000 }),
      fc.integer({ min: 0, max: 200_000 }),
      fc.integer({ min: MS_LO, max: MS_HI }),
      fc.integer({ min: 0, max: MAX_MS_STEP }),
    )
    .map(([state, w, c1, cInc, ms1, msInc]) => ({
      state,
      w,
      commit1: c1,
      commit2: c1 + cInc,
      ms1,
      ms2: ms1 + msInc,
    }));
}

function checkAges(c: AgeCase, cfg: LetheConfig): void {
  const r1 = computeRetention(c.dc1, c.state.stability, c.w, cfg.sMin);
  const r2 = computeRetention(c.dc2, c.state.stability, c.w, cfg.sMin);
  if (!(r1 >= r2)) {
    fail(`dc1=${c.dc1} <= dc2=${c.dc2} (S=${c.state.stability}, W=${c.w}) but R1=${r1} < R2=${r2}`);
  }
}

function checkTimes(c: TimeCase, cfg: LetheConfig): void {
  const iso1 = new Date(c.ms1).toISOString();
  const iso2 = new Date(c.ms2).toISOString();
  const d1 = computeDeltaC(c.state, c.commit1, iso1, cfg.alpha);
  const d2 = computeDeltaC(c.state, c.commit2, iso2, cfg.alpha);
  if (!(d1 <= d2)) {
    fail(`deltaC decreased: ${d1} (commit ${c.commit1}, ${iso1}) > ${d2} (commit ${c.commit2}, ${iso2})`);
  }
  const r1 = computeRetention(d1, c.state.stability, c.w, cfg.sMin);
  const r2 = computeRetention(d2, c.state.stability, c.w, cfg.sMin);
  if (!(r1 >= r2)) {
    fail(`deltaC ${d1} <= ${d2} but retention rose from ${r1} to ${r2} (S=${c.state.stability}, W=${c.w})`);
  }
}

export function p2Monotonic(cfg: LetheConfig) {
  return fc.property(ageCaseArb(cfg), timeCaseArb(cfg), (ages, times) => {
    checkAges(ages, cfg);
    checkTimes(times, cfg);
  });
}
