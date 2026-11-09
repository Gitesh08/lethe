// Arbitraries producing EngramState values and time inputs for decay PBTs.
// Refs: REQ-PBT-4
import * as fc from "fast-check";
import type { EngramState, LetheConfig } from "../../types.js";

const MS_START = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
const MS_END = Date.UTC(2027, 11, 31, 23, 59, 59, 999);
const MAX_COMMIT = 5000;

/** Valid ISO-8601 UTC timestamps in [2026-01-01, 2027-12-31], built from integer ms. */
export const isoArb: fc.Arbitrary<string> = fc
  .integer({ min: MS_START, max: MS_END })
  .map((ms) => new Date(ms).toISOString());

const ID_POOL: readonly string[] = [
  ".kiro/steering/a.md#rules",
  ".kiro/steering/a.md#rules/state",
  ".kiro/steering/b.md#notes",
  "日本語.md#見出し",
  "x.md#e\u0301",
];

/** Small pool of ids (collisions likely) or arbitrary slug-like strings. */
export const idArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(...ID_POOL) },
  {
    weight: 1,
    arbitrary: fc
      .array(fc.constantFrom(..."abcdefghij0123456789-_/#.".split("")), { minLength: 1, maxLength: 24 })
      .map((cs) => cs.join("")),
  },
);

const stabilityArb = (lo: number, hi: number): fc.Arbitrary<number> =>
  fc.double({ min: lo, max: hi, noNaN: true, noDefaultInfinity: true });

const reinforcementsArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 1000 });

/** Arbitrary valid EngramState within config stability bounds. */
export function engramStateArb(
  cfg: LetheConfig,
  id: fc.Arbitrary<string> = idArb,
): fc.Arbitrary<EngramState> {
  return fc.record({
    id,
    stability: stabilityArb(cfg.sMin, cfg.sMax),
    lastReinforcedCommit: fc.integer({ min: 0, max: MAX_COMMIT }),
    lastReinforcedAt: isoArb,
    reinforcements: reinforcementsArb,
  });
}

/** States reinforced in a narrow commit/time window (bursty activity). */
export function burstyStateArb(cfg: LetheConfig): fc.Arbitrary<EngramState> {
  return fc
    .tuple(
      fc.integer({ min: 0, max: MAX_COMMIT - 10 }),
      fc.integer({ min: MS_START, max: MS_END - 1000 }),
    )
    .chain(([baseCommit, baseMs]) =>
      fc.record({
        id: idArb,
        stability: stabilityArb(cfg.sMin, cfg.sMax),
        lastReinforcedCommit: fc.integer({ min: baseCommit, max: baseCommit + 10 }),
        lastReinforcedAt: fc
          .integer({ min: baseMs, max: baseMs + 1000 })
          .map((ms) => new Date(ms).toISOString()),
        reinforcements: reinforcementsArb,
      }),
    );
}

/** Weak, never-reinforced-since-start states: pair with a large nowCommit. */
export function longIdleStateArb(cfg: LetheConfig): fc.Arbitrary<EngramState> {
  return fc.record({
    id: idArb,
    stability: stabilityArb(cfg.sMin, 2 * cfg.sMin),
    lastReinforcedCommit: fc.constant(0),
    lastReinforcedAt: isoArb,
    reinforcements: reinforcementsArb,
  });
}

/** Long idle gaps in commits (REQ-PBT-4: >= 500). */
export const idleGapArb: fc.Arbitrary<number> = fc.integer({ min: 500, max: 100000 });

/** Non-negative integer commit counters. */
export const nowCommitArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 200000 });

/** A "now" (commit + ISO) that is not earlier than the state's last reinforcement. */
export function nowAfter(
  state: EngramState,
): fc.Arbitrary<{ nowCommit: number; nowISO: string }> {
  const lastMs = Date.parse(state.lastReinforcedAt);
  return fc.record({
    nowCommit: fc.integer({ min: state.lastReinforcedCommit, max: state.lastReinforcedCommit + 100000 }),
    nowISO: fc
      .integer({ min: lastMs, max: Math.max(lastMs, MS_END) + 86_400_000 })
      .map((ms) => new Date(ms).toISOString()),
  });
}
