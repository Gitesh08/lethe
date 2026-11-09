// P3: reinforcement never lowers S and never lowers R at the same instant.
// Refs: REQ-DEC-3, REQ-PBT-1

import fc from "fast-check";
import { ledgerEventArb } from "./arbitraries/ledger.arb.js";
import { engramStateArb } from "./arbitraries/state.arb.js";
import { computeDeltaC } from "../decay/delta.js";
import { reinforce } from "../decay/reinforce.js";
import { computeRetention } from "../decay/retention.js";
import type { EngramState, LedgerEvent, LetheConfig } from "../types.js";

export const P3_ID = "P3";

const COMMIT_MAX = 6000;
const NOW_SLACK_MS = 10_000_000_000;

interface Scenario {
  readonly state: EngramState;
  readonly ev: LedgerEvent;
  readonly useSpecWeight: boolean;
  readonly nowCommit: number;
  readonly nowISO: string;
}

function fail(msg: string): never {
  throw new Error(`${P3_ID} violated: ${msg}`);
}

function deepFreeze<T extends object>(o: T): T {
  for (const v of Object.values(o)) {
    if (typeof v === "object" && v !== null) deepFreeze(v);
  }
  return Object.freeze(o);
}

/** A common "now" that is not earlier than either the state or the event. */
function nowArb(
  state: EngramState,
  ev: LedgerEvent,
): fc.Arbitrary<{ nowCommit: number; nowISO: string }> {
  const minCommit = Math.max(state.lastReinforcedCommit, ev.commit);
  const minMs = Math.max(Date.parse(state.lastReinforcedAt), Date.parse(ev.at));
  return fc.record({
    nowCommit: fc.integer({ min: minCommit, max: minCommit + 100000 }),
    nowISO: fc
      .integer({ min: minMs, max: minMs + NOW_SLACK_MS })
      .map((ms) => new Date(ms).toISOString()),
  });
}

function scenarioArb(cfg: LetheConfig): fc.Arbitrary<Scenario> {
  return engramStateArb(cfg).chain((state) =>
    fc
      .integer({ min: 0, max: COMMIT_MAX })
      .chain((commit) => ledgerEventArb(commit))
      .chain((ev) =>
        fc.tuple(fc.boolean(), nowArb(state, ev)).map(([useSpecWeight, now]) => ({
          state,
          ev,
          useSpecWeight,
          ...now,
        })),
      ),
  );
}

function checkStructure(before: EngramState, snapshot: string, next: EngramState): void {
  if (JSON.stringify(before) !== snapshot) fail("input state was mutated");
  if (!(next.stability >= before.stability)) {
    fail(`stability dropped ${before.stability} -> ${next.stability}`);
  }
  if (next.reinforcements !== before.reinforcements + 1) {
    fail(`reinforcements ${before.reinforcements} -> ${next.reinforcements}, expected +1`);
  }
}

function checkRetention(sc: Scenario, next: EngramState, cfg: LetheConfig): void {
  const w = sc.useSpecWeight ? cfg.wSpec : cfg.wDefault;
  const dBefore = computeDeltaC(sc.state, sc.nowCommit, sc.nowISO, cfg.alpha);
  const dAfter = computeDeltaC(next, sc.nowCommit, sc.nowISO, cfg.alpha);
  const rBefore = computeRetention(dBefore, sc.state.stability, w, cfg.sMin);
  const rAfter = computeRetention(dAfter, next.stability, w, cfg.sMin);
  if (!(rAfter >= rBefore)) {
    fail(
      `R dropped ${rBefore} -> ${rAfter} (W=${w}, deltaC ${dBefore} -> ${dAfter}, ` +
        `state.at=${sc.state.lastReinforcedAt}, ev.at=${sc.ev.at}, next.at=${next.lastReinforcedAt})`,
    );
  }
}

function checkScenario(sc: Scenario, cfg: LetheConfig): void {
  const frozen = deepFreeze({ ...sc.state });
  const snapshot = JSON.stringify(frozen);
  const next = reinforce(frozen, sc.ev, cfg);
  checkStructure(frozen, snapshot, next);
  checkRetention(sc, next, cfg);
}

export function p3Reinforce(cfg: LetheConfig) {
  return fc.property(scenarioArb(cfg), (sc) => {
    checkScenario(sc, cfg);
  });
}
