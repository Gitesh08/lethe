// Arbitrary ScoreInput values (engrams + states + specs + ledger + now) for PBTs.
// Refs: REQ-PBT-4
import fc from "fast-check";
import type { ScoreInput } from "../../decay/score.js";
import type { EngramNode, EngramState, LetheConfig, SpecInvariant } from "../../types.js";
import { engramNodeArb } from "./engram-node.arb.js";
import { anyLedgerArb, ENGRAM_ID_POOL, SPEC_NAME_POOL } from "./ledger.arb.js";
import { engramStateArb, isoArb, nowCommitArb } from "./state.arb.js";

const EXTRA_IDS: readonly string[] = Array.from({ length: 20 }, (_, i) => `.kiro/steering/extra.md#e${i}`);
const ALL_IDS: readonly string[] = [...ENGRAM_ID_POOL, ...EXTRA_IDS];
const STRAY_IDS: readonly string[] = ["stray/x.md#s0", "stray/x.md#s1", "stray/y.md#s2"];
const SPEC_NAMES: readonly string[] = [...SPEC_NAME_POOL, "legacy-spec"];
const LINK_NAMES: readonly string[] = [...SPEC_NAMES, "spec-unknown"];
const IDLE_MIN = 1_000_000;
const IDLE_MAX = 10_000_000;

const nowCommitMixArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 4, arbitrary: nowCommitArb },
  { weight: 1, arbitrary: fc.integer({ min: IDLE_MIN, max: IDLE_MAX }) },
);

function makeSpecs(activeNames: readonly string[]): readonly SpecInvariant[] {
  return SPEC_NAMES.map((specName) => ({
    specName,
    active: activeNames.includes(specName),
    requirementIds: [],
    stances: [],
  }));
}

const activeNamesArb: fc.Arbitrary<readonly string[]> = fc.subarray([...SPEC_NAMES]);
const nonEmptyActiveArb: fc.Arbitrary<readonly string[]> = fc.subarray([...SPEC_NAMES], { minLength: 1 });
const anyLinksArb: fc.Arbitrary<readonly string[]> = fc.subarray([...LINK_NAMES], { maxLength: 3 });

function activeLinksArb(active: readonly string[]): fc.Arbitrary<readonly string[]> {
  return fc.tuple(fc.constantFrom(...active), anyLinksArb).map(([a, rest]) => [...new Set([a, ...rest])]);
}

function nodesArb(
  ids: readonly string[],
  links: fc.Arbitrary<readonly string[]>,
): fc.Arbitrary<readonly EngramNode[]> {
  return fc.tuple(...ids.map((id) => engramNodeArb(id, { specLinks: links })));
}

function statesArb(
  cfg: LetheConfig,
  ids: readonly string[],
): fc.Arbitrary<readonly EngramState[]> {
  const known = fc.subarray([...ids]);
  const stray = fc.subarray([...STRAY_IDS]);
  return fc
    .tuple(known, stray)
    .chain(([k, s]) => fc.tuple(...[...k, ...s].map((id) => engramStateArb(cfg, fc.constant(id)))));
}

function assemble(
  cfg: LetheConfig,
  idsArb: fc.Arbitrary<readonly string[]>,
  engramsOf: (ids: readonly string[]) => fc.Arbitrary<readonly EngramNode[]>,
  activeArb: fc.Arbitrary<readonly string[]>,
): fc.Arbitrary<ScoreInput> {
  return fc.tuple(idsArb, activeArb).chain(([ids, active]) =>
    fc
      .record({
        engrams: engramsOf(ids),
        states: statesArb(cfg, ids),
        ledger: anyLedgerArb,
        nowCommit: nowCommitMixArb,
        nowISO: isoArb,
      })
      .map((r) => ({ ...r, specs: makeSpecs(active), cfg })),
  );
}

const idsArb: fc.Arbitrary<readonly string[]> = fc.uniqueArray(fc.constantFrom(...ALL_IDS), {
  minLength: 1,
  maxLength: 20,
});

/** Mixed protected/unprotected engram sets with partial states and ledger. */
export function scoreInputArb(cfg: LetheConfig): fc.Arbitrary<ScoreInput> {
  return assemble(cfg, idsArb, (ids) => nodesArb(ids, anyLinksArb), activeNamesArb);
}

/** Every engram links to at least one ACTIVE spec (hence protected). */
export function allSpecLinkedInputArb(cfg: LetheConfig): fc.Arbitrary<ScoreInput> {
  return fc.tuple(idsArb, nonEmptyActiveArb).chain(([ids, active]) =>
    assemble(
      cfg,
      fc.constant(ids),
      (i) => nodesArb(i, activeLinksArb(active)),
      fc.constant(active),
    ),
  );
}

/** No engrams; states/ledger may still be non-empty. */
export function emptyEngramsInputArb(cfg: LetheConfig): fc.Arbitrary<ScoreInput> {
  return assemble(cfg, idsArb, () => fc.constant<readonly EngramNode[]>([]), activeNamesArb);
}

/** Weighted mix of the three shapes. */
export function anyScoreInputArb(cfg: LetheConfig): fc.Arbitrary<ScoreInput> {
  return fc.oneof(
    { weight: 6, arbitrary: scoreInputArb(cfg) },
    { weight: 2, arbitrary: allSpecLinkedInputArb(cfg) },
    { weight: 1, arbitrary: emptyEngramsInputArb(cfg) },
  );
}
