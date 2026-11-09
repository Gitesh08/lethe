/**
 * Deterministic contradiction detection. Covers: REQ-CON-2..6.
 *
 * Returns reports only; engram status is NOT changed here. Use `applyDefeats`
 * (defeat.ts) to realise "loser status = defeated" (REQ-CON-3.6).
 * Stances in reports are stance ids; negated matches are prefixed "not:".
 */
import { ok } from "../result.js";
import type { ContradictionReport, LetheError, Ontology, Result, ScoredEngram, SpecInvariant, StanceMatch } from "../types.js";
import { DEFAULT_AXES } from "./default-ontology.js";
import { pairReports, type AxisSide } from "./detect-pairs.js";
import { mergeOntology } from "./merge-ontology.js";
import { scanEngram } from "./scan.js";
import { buildSpecSides } from "./spec-side.js";
import { validateOntology } from "./validate-ontology.js";

interface Entry {
  readonly engram: ScoredEngram;
  readonly spec: boolean;
  readonly matches: readonly StanceMatch[];
}

function byAxis(entries: readonly Entry[], axisId: string): readonly AxisSide[] {
  const sides: AxisSide[] = [];
  for (const e of entries) {
    const matches = e.matches.filter((m) => m.axisId === axisId);
    if (matches.length > 0) sides.push({ engram: e.engram, spec: e.spec, matches });
  }
  return sides.sort((x, y) => (x.engram.node.id < y.engram.node.id ? -1 : x.engram.node.id > y.engram.node.id ? 1 : 0));
}

function cmp(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

function compareReports(p: ContradictionReport, q: ContradictionReport): number {
  return cmp(p.axis, q.axis) || cmp(p.a.id, q.a.id) || cmp(p.b.id, q.b.id) ||
    cmp(p.a.stance, q.a.stance) || cmp(p.b.stance, q.b.stance);
}

export function detectContradictions(
  scored: readonly ScoredEngram[],
  specs: readonly SpecInvariant[],
  ontology?: Ontology,
): Result<readonly ContradictionReport[], LetheError> {
  const compiled = validateOntology(mergeOntology(DEFAULT_AXES, ontology));
  if (!compiled.ok) return compiled;
  const entries: Entry[] = scored.map((engram) => ({
    engram,
    spec: false,
    matches: scanEngram(engram.node.body, compiled.value),
  }));
  for (const s of buildSpecSides(specs, compiled.value)) entries.push({ ...s, spec: true });
  const reports: ContradictionReport[] = [];
  for (const axis of compiled.value) {
    reports.push(...pairReports(axis.id, byAxis(entries, axis.id)));
  }
  return ok(reports.sort(compareReports));
}
