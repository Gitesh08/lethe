// P4: protected (pinned or active-spec-linked) engrams are never archived and
// always have R >= specFloor.
//
// Two halves:
//  - DECAY half (always runs): for arbitrary nodes/specs/states/now (incl. 1e6
//    idle commits) it checks computeWeight + computeRetention + floor:
//      pinned OR any active-spec link  <=>  isProtected,
//      protected   => floor = specFloor and floor-adjusted R >= specFloor,
//      unprotected => floor = 0 and R === rawR.
//  - ARCHIVE half (optional): pass `planArchivedIds`, a callback mapping the
//    scored set to the ids a consolidation plan would archive. When provided,
//    no protected engram's id may be in that set.
//  - END-TO-END half (always runs, see p4-pipeline.ts): the real
//    runConsolidation never archives, merges away or demotes a protected
//    engram, never needs applyPlan's "protected" safety net, keeps its text,
//    creates no tombstone for it, and keeps retention >= specFloor.
//
// `p4Protected(cfg)` runs decay + end-to-end; `p4ProtectedEndToEnd(cfg)` only the latter.
// INV-1 is fully covered.
// Refs: REQ-CRY-1, REQ-DEC-4, REQ-DEC-7, INV-1

import fc from "fast-check";
import { checkEndToEnd, e2eCaseArb } from "./p4-pipeline.js";
import { engramStateArb, nowAfter } from "./arbitraries/state.arb.js";
import { computeDeltaC } from "../decay/delta.js";
import { computeRetention } from "../decay/retention.js";
import { computeWeight } from "../decay/weight.js";
import type {
  EngramNode,
  EngramState,
  LetheConfig,
  ScoredEngram,
  SpecInvariant,
  Tier,
} from "../types.js";

export const P4_ID = "P4";

const SPEC_POOL: readonly string[] = ["spec-a", "spec-b", "spec-c"];
const LINK_POOL: readonly string[] = [...SPEC_POOL, "spec-unknown"];
const IDLE_COMMITS = 1e6;

interface Now {
  readonly nowCommit: number;
  readonly nowISO: string;
}

interface Case {
  readonly node: EngramNode;
  readonly state: EngramState;
  readonly now: Now;
}

function fail(msg: string): never {
  throw new Error(`${P4_ID} violated: ${msg}`);
}

const specArb: fc.Arbitrary<SpecInvariant> = fc.record({
  specName: fc.constantFrom(...SPEC_POOL),
  active: fc.boolean(),
  requirementIds: fc.constant<readonly string[]>([]),
  stances: fc.constant<readonly string[]>([]),
});

const nodeArb: fc.Arbitrary<EngramNode> = fc.record({
  id: fc.constant("n"),
  file: fc.constant("steering/p4.md"),
  headingPath: fc.constant<readonly string[]>(["p4"]),
  body: fc.constant("body"),
  contentHash: fc.constant("h"),
  tokens: fc.integer({ min: 1, max: 500 }),
  globs: fc.constant<readonly string[]>([]),
  specLinks: fc.uniqueArray(fc.constantFrom(...LINK_POOL), { maxLength: 4 }),
  pinned: fc.boolean(),
  span: fc.constant({ start: 0, end: 4 }),
});

/** Either a random later "now" or a fixed 1e6-commit idle gap. */
function nowArb(state: EngramState): fc.Arbitrary<Now> {
  return fc.oneof(
    nowAfter(state),
    nowAfter(state).map((n) => ({
      nowCommit: state.lastReinforcedCommit + IDLE_COMMITS,
      nowISO: n.nowISO,
    })),
  );
}

function caseArb(cfg: LetheConfig): fc.Arbitrary<Case> {
  return fc
    .tuple(nodeArb, engramStateArb(cfg))
    .chain(([node, state]) => nowArb(state).map((now) => ({ node, state, now })));
}

function tierOf(r: number, cfg: LetheConfig): Tier {
  if (r >= cfg.hotMin) return "hot";
  return r < cfg.cryptMax ? "crypt" : "warm";
}

/** Independent oracle: pinned, or linked to a spec that is active. */
function expectProtected(node: EngramNode, specs: readonly SpecInvariant[]): boolean {
  if (node.pinned) return true;
  return node.specLinks.some((l) => specs.some((s) => s.active && s.specName === l));
}

function checkDecay(label: string, s: ScoredEngram, expected: boolean, floor: number, cfg: LetheConfig): void {
  if (s.protected !== expected) fail(`${label}: protected=${s.protected}, expected ${expected}`);
  if (s.protected) {
    if (floor !== cfg.specFloor) fail(`${label}: protected floor ${floor} !== specFloor ${cfg.specFloor}`);
    if (!(s.retention >= cfg.specFloor)) {
      fail(`${label}: protected retention ${s.retention} < specFloor ${cfg.specFloor} (raw ${s.rawRetention}, deltaC ${s.deltaC})`);
    }
    return;
  }
  if (floor !== 0) fail(`${label}: unprotected floor ${floor} !== 0`);
  if (s.retention !== s.rawRetention) {
    fail(`${label}: unprotected retention ${s.retention} !== rawR ${s.rawRetention}`);
  }
}

function scoreCase(c: Case, index: number, specs: readonly SpecInvariant[], cfg: LetheConfig): ScoredEngram {
  const id = `n${index}`;
  const node: EngramNode = { ...c.node, id };
  const state: EngramState = { ...c.state, id };
  const w = computeWeight(node, specs, cfg);
  const deltaC = computeDeltaC(state, c.now.nowCommit, c.now.nowISO, cfg.alpha);
  const rawR = computeRetention(deltaC, state.stability, w.W, cfg.sMin);
  const retention = Math.max(rawR, w.floor);
  const scored: ScoredEngram = {
    node,
    state,
    deltaC,
    weight: w.W,
    retention,
    rawRetention: rawR,
    tier: tierOf(retention, cfg),
    status: "active",
    protected: w.isProtected,
  };
  checkDecay(id, scored, expectProtected(node, specs), w.floor, cfg);
  return scored;
}

function checkArchive(
  scored: readonly ScoredEngram[],
  planArchivedIds: (scored: readonly ScoredEngram[]) => ReadonlySet<string>,
): void {
  const archived = planArchivedIds(scored);
  for (const s of scored) {
    if (s.protected && archived.has(s.node.id)) fail(`protected engram "${s.node.id}" is in the archived set`);
  }
}

function decayInputArb(cfg: LetheConfig) {
  return fc.tuple(
    fc.array(specArb, { maxLength: 4 }),
    fc.array(caseArb(cfg), { minLength: 1, maxLength: 5 }),
  );
}

type DecayInput = readonly [readonly SpecInvariant[], readonly Case[]];

function runDecayHalf(
  [specs, cases]: DecayInput,
  cfg: LetheConfig,
  planArchivedIds?: (scored: readonly ScoredEngram[]) => ReadonlySet<string>,
): void {
  const scored = cases.map((c, i) => scoreCase(c, i, specs, cfg));
  if (planArchivedIds !== undefined) checkArchive(scored, planArchivedIds);
}

/** End-to-end half only: the real pipeline never buries/merges/demotes protected engrams. */
export function p4ProtectedEndToEnd(cfg: LetheConfig) {
  return fc.property(e2eCaseArb(cfg), (c) => checkEndToEnd(c, cfg));
}

/** Decay half + end-to-end half (always both). */
export function p4Protected(
  cfg: LetheConfig,
  planArchivedIds?: (scored: readonly ScoredEngram[]) => ReadonlySet<string>,
) {
  return fc.property(decayInputArb(cfg), e2eCaseArb(cfg), (d, c) => {
    runDecayHalf(d, cfg, planArchivedIds);
    checkEndToEnd(c, cfg);
  });
}
