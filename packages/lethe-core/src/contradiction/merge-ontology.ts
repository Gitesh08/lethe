/**
 * Merge a user ontology extension into the base. Covers: REQ-CON-5.
 * Matching ids are replaced at stance granularity; new ids are appended.
 */
import type { Axis, Stance } from "../types.js";

function mergeStances(base: readonly Stance[], ext: readonly Stance[]): readonly Stance[] {
  const extById = new Map<string, Stance>();
  for (const s of ext) extById.set(s.id, s);
  const baseIds = new Set(base.map((s) => s.id));
  const replaced = base.map((s) => extById.get(s.id) ?? s);
  const added = ext.filter((s) => !baseIds.has(s.id));
  return [...replaced, ...added];
}

function mergeAxis(base: Axis, ext: Axis): Axis {
  return {
    id: base.id,
    description: ext.description !== "" ? ext.description : base.description,
    stances: mergeStances(base.stances, ext.stances),
  };
}

export function mergeOntology(
  base: readonly Axis[],
  extension: readonly Axis[] | undefined,
): readonly Axis[] {
  if (extension === undefined || extension.length === 0) return [...base];
  const extById = new Map<string, Axis>();
  for (const a of extension) extById.set(a.id, a);
  const baseIds = new Set(base.map((a) => a.id));
  const merged = base.map((a) => {
    const e = extById.get(a.id);
    return e === undefined ? a : mergeAxis(a, e);
  });
  const added = extension.filter((a, i) => !baseIds.has(a.id) && extension.findIndex((x) => x.id === a.id) === i);
  return [...merged, ...added];
}
