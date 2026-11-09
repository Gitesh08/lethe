/** Synthetic sides for active specs. Covers: REQ-CON-3 (spec wins), REQ-CON-6. */
import type { ScoredEngram, SpecInvariant, StanceMatch } from "../types.js";
import type { CompiledOntology } from "./compiled-types.js";

export const SPEC_ID_PREFIX = "spec:";

export interface SpecSide {
  readonly engram: ScoredEngram;
  readonly matches: readonly StanceMatch[];
}

function syntheticEngram(specName: string): ScoredEngram {
  const id = `${SPEC_ID_PREFIX}${specName}`;
  return {
    node: {
      id,
      file: "",
      headingPath: [],
      body: "",
      contentHash: "",
      tokens: 0,
      globs: [],
      specLinks: [],
      pinned: true,
      span: { start: 0, end: 0 },
    },
    state: {
      id,
      stability: 1,
      lastReinforcedCommit: Number.MAX_SAFE_INTEGER,
      lastReinforcedAt: "",
      reinforcements: 0,
    },
    deltaC: 0,
    weight: 1,
    retention: 1,
    rawRetention: 1,
    tier: "hot",
    status: "active",
    protected: true,
  };
}

function axisOfStance(compiled: CompiledOntology, stanceId: string): string | undefined {
  for (const axis of compiled) {
    if (axis.stances.some((s) => s.id === stanceId)) return axis.id;
  }
  return undefined;
}

/** One side per active spec with at least one known stance. Unknown stance ids are ignored. */
export function buildSpecSides(
  specs: readonly SpecInvariant[],
  compiled: CompiledOntology,
): readonly SpecSide[] {
  // Specs sharing a name share one synthetic id, so they are merged into one side
  // (keeps one report per (axis, a.id, b.id) triple; found by P11).
  const byName = new Map<string, StanceMatch[]>();
  for (const spec of specs) {
    if (!spec.active || spec.stances.length === 0) continue;
    for (const stanceId of spec.stances) {
      const axisId = axisOfStance(compiled, stanceId);
      if (axisId === undefined) continue;
      const list = byName.get(spec.specName) ?? [];
      list.push({ axisId, stanceId, polarity: "+", evidence: `spec stance ${stanceId}` });
      byName.set(spec.specName, list);
    }
  }
  const out: SpecSide[] = [];
  for (const [name, matches] of byName) out.push({ engram: syntheticEngram(name), matches });
  return out;
}
