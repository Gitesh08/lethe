// Derives states / specs / ledger / now from the ids learned by PARSING generated documents,
// so every generated value actually matches the workspace. Refs: REQ-PBT-4
import fc from "fast-check";
import type { PipelineInput } from "../../consolidate/pipeline.js";
import { parseDocument } from "../../parse/document.js";
import type { EngramState, LedgerEvent, LetheConfig, SpecInvariant } from "../../types.js";
import { renderDoc, SPEC_NAMES } from "./adversarial-docs.arb.js";
import type { DocSpec } from "./adversarial-docs.arb.js";
import { isoArb } from "./state.arb.js";

export type StateKind = "none" | "fresh" | "stale" | "aged";

export const STALE_ISO = "2026-01-01T00:00:00.000Z";
const STANCES: readonly string[] = ["test:jest", "test:vitest", "css:tailwind", "css:pure-css", "state:signals", "state:redux"];
const STRAYS: readonly string[] = ["stray.md#ghost0", "stray.md#ghost1"];

export interface AssembleOpts {
  readonly specs: fc.Arbitrary<readonly SpecInvariant[]>;
  readonly ledger: fc.Arbitrary<readonly LedgerEvent[]>;
  readonly nowCommit: (ledger: readonly LedgerEvent[]) => fc.Arbitrary<number>;
  readonly kinds: readonly StateKind[];
}

export function makeSpecs(active: readonly string[]): readonly SpecInvariant[] {
  return SPEC_NAMES.map((specName) => ({
    specName,
    active: active.includes(specName),
    requirementIds: [`REQ-${specName}`],
    stances: [],
  }));
}

/** Random active flags and 0-2 asserted stances per spec. */
export const specsArb: fc.Arbitrary<readonly SpecInvariant[]> = fc.tuple(
  ...SPEC_NAMES.map((specName) =>
    fc
      .record({ active: fc.boolean(), stances: fc.subarray([...STANCES], { maxLength: 2 }) })
      .map((r): SpecInvariant => ({ specName, active: r.active, requirementIds: [`REQ-${specName}`], stances: r.stances })),
  ),
);

/** Mix of small, medium and huge commit counters. */
export const nowCommitMixArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: 5, max: 60 }) },
  { weight: 3, arbitrary: fc.integer({ min: 200, max: 5000 }) },
  { weight: 1, arbitrary: fc.integer({ min: 1_000_000, max: 10_000_000 }) },
);

export function idsOf(docs: readonly DocSpec[], cfg: LetheConfig): readonly string[] {
  const ids: string[] = [];
  for (const d of docs) {
    const parsed = parseDocument(d.path, renderDoc(d), cfg);
    if (parsed.ok) ids.push(...parsed.value.engrams.map((e) => e.id));
  }
  return ids;
}

interface Ctx {
  readonly cfg: LetheConfig;
  readonly nowCommit: number;
  readonly nowISO: string;
}

function buildState(kind: StateKind, id: string, u: number, reinf: number, c: Ctx): EngramState | null {
  const { cfg } = c;
  switch (kind) {
    case "none":
      return null;
    case "stale":
      return { id, stability: cfg.sMin * (1 + u), lastReinforcedCommit: 0, lastReinforcedAt: STALE_ISO, reinforcements: reinf };
    case "aged":
      return {
        id,
        stability: cfg.sMin + u * (cfg.sMax - cfg.sMin),
        lastReinforcedCommit: Math.floor(u * 1000),
        lastReinforcedAt: STALE_ISO,
        reinforcements: reinf,
      };
    case "fresh":
      return {
        id,
        stability: cfg.s0 + u * (cfg.sMax - cfg.s0),
        lastReinforcedCommit: Math.max(0, c.nowCommit - Math.floor(u * 3)),
        lastReinforcedAt: c.nowISO,
        reinforcements: reinf,
      };
  }
}

function statesArb(ids: readonly string[], kinds: readonly StateKind[], c: Ctx): fc.Arbitrary<readonly EngramState[]> {
  const one = (id: string): fc.Arbitrary<EngramState | null> =>
    fc
      .tuple(fc.constantFrom(...kinds), fc.double({ min: 0, max: 1, noNaN: true }), fc.integer({ min: 0, max: 5 }))
      .map(([kind, u, reinf]) => buildState(kind, id, u, reinf, c));
  return fc
    .tuple(fc.subarray([...STRAYS]), ...[...ids].map(one))
    .map(([strays, ...sts]) => {
      const real = sts.filter((s): s is EngramState => s !== null);
      const fake = strays.map((id) => buildState("stale", id, 0, 0, c));
      return [...real, ...fake.filter((s): s is EngramState => s !== null)];
    });
}

/** Turn a document generator into full PipelineInputs. */
export function assemble(
  cfg: LetheConfig,
  docs: fc.Arbitrary<readonly DocSpec[]>,
  o: AssembleOpts,
): fc.Arbitrary<PipelineInput> {
  return fc.tuple(docs, o.specs, o.ledger).chain(([ds, specs, ledger]) =>
    fc.tuple(o.nowCommit(ledger), isoArb).chain(([nowCommit, nowISO]) => {
      const files = new Map(ds.map((d) => [d.path, renderDoc(d)] as const));
      return statesArb(idsOf(ds, cfg), o.kinds, { cfg, nowCommit, nowISO }).map(
        (states): PipelineInput => ({
          workspace: { files, tombstones: [] },
          states,
          specs,
          ledger,
          nowCommit,
          nowISO,
          cfg,
        }),
      );
    }),
  );
}
