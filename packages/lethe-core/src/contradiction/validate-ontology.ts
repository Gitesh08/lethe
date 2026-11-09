/**
 * Ontology validation + compilation. Covers: REQ-CON-1, REQ-CON-5.
 * Patterns compile with the "i" flag only (no g/y: stateful lastIndex).
 */
import { err, ok } from "../result.js";
import type { Axis, LetheError, Result, Stance } from "../types.js";
import type { CompiledAxis, CompiledOntology, CompiledStance } from "./compiled-types.js";

export type { CompiledOntology } from "./compiled-types.js";

/** ReDoS surface cap on pattern source length. */
const MAX_PATTERN_LENGTH = 512;

function fail(message: string, detail: Record<string, unknown>): Result<never, LetheError> {
  return err({ code: "ONTOLOGY_INVALID_PATTERN", message, detail });
}

function compilePattern(
  axisId: string,
  stanceId: string,
  pattern: string,
): Result<RegExp, LetheError> {
  const detail = { axis: axisId, stance: stanceId, pattern };
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return fail(`Pattern exceeds ${MAX_PATTERN_LENGTH} characters in ${axisId}/${stanceId}`, detail);
  }
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return fail(`Invalid regex in ${axisId}/${stanceId}: ${reason}`, detail);
  }
  if (regex.test("")) {
    return fail(`Pattern matches the empty string in ${axisId}/${stanceId}`, detail);
  }
  return ok(regex);
}

function compileStance(axisId: string, s: Stance): Result<CompiledStance, LetheError> {
  if (s.id === "") {
    return fail(`Empty stance id in axis ${axisId}`, { axis: axisId, stance: s.id });
  }
  if (s.patterns.length === 0) {
    return fail(`Stance ${axisId}/${s.id} has no patterns`, { axis: axisId, stance: s.id });
  }
  const regexes: RegExp[] = [];
  for (const pattern of s.patterns) {
    const r = compilePattern(axisId, s.id, pattern);
    if (!r.ok) return r;
    regexes.push(r.value);
  }
  return ok({ id: s.id, label: s.label, negationAware: s.negationAware, regexes });
}

function compileAxis(a: Axis): Result<CompiledAxis, LetheError> {
  if (a.id === "") return fail("Empty axis id", { axis: a.id });
  const seen = new Set<string>();
  const stances: CompiledStance[] = [];
  for (const s of a.stances) {
    if (seen.has(s.id)) {
      return fail(`Duplicate stance id ${s.id} in axis ${a.id}`, { axis: a.id, stance: s.id });
    }
    seen.add(s.id);
    const r = compileStance(a.id, s);
    if (!r.ok) return r;
    stances.push(r.value);
  }
  return ok({ id: a.id, description: a.description, stances });
}

/** Validate every pattern in every axis; first failure (axis, stance, pattern order) wins. */
export function validateOntology(axes: readonly Axis[]): Result<CompiledOntology, LetheError> {
  const seen = new Set<string>();
  const out: CompiledAxis[] = [];
  for (const a of axes) {
    if (seen.has(a.id)) return fail(`Duplicate axis id ${a.id}`, { axis: a.id });
    seen.add(a.id);
    const r = compileAxis(a);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return ok(out);
}
