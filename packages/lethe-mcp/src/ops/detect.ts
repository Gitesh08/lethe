// Operation behind lethe_detect_contradictions. Read-only: no write, no lock.
// Refs: Req 3.2, 3.3, 3.4, 3.5
//
// API: detectContradictionsOp(ctx, { scope }) -> Envelope<DetectData>
//   - scope "all" keeps every report; "steering-vs-specs" keeps reports where exactly one id starts with "spec:".
//   - an invalid user ontology pattern surfaces as an ONTOLOGY_INVALID_PATTERN error envelope with no reports.
import { detectContradictions, type ContradictionReport } from "@lethe/core";
import type { Diagnostic } from "../envelope/diagnostics.js";
import { fail, ok, type Envelope } from "../envelope/envelope.js";
import { mapCoreError } from "../envelope/errors.js";
import { loadWorkspace } from "../load/workspace.js";
import type { RunContext } from "./context.js";
import { checkpointView } from "./view.js";

export type DetectScope = "steering-vs-specs" | "all";

export interface DetectArgs {
  readonly scope: DetectScope;
}

export interface DetectData {
  readonly reports: ReadonlyArray<ContradictionReport>;
  readonly count: number;
  readonly unresolvable: number;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

const isSpecId = (id: string): boolean => id.startsWith("spec:");

export function inScope(r: ContradictionReport, scope: DetectScope): boolean {
  return scope === "all" || isSpecId(r.a.id) !== isSpecId(r.b.id);
}

export async function detectContradictionsOp(ctx: RunContext, args: DetectArgs): Promise<Envelope<DetectData>> {
  const loaded = await loadWorkspace(ctx.fsx, { includeSpecs: false });
  if (!loaded.ok) return fail(loaded.error);
  const view = await checkpointView(ctx, loaded.value);
  if (!view.ok) return fail(view.error);
  const found = detectContradictions(view.value.scored, loaded.value.specs, loaded.value.ontology);
  if (!found.ok) return fail(mapCoreError(found.error));

  const reports = found.value.filter((r) => inScope(r, args.scope));
  const unresolvable = reports.filter((r) => r.resolution.kind === "unresolvable").length;
  const diagnostics = [...ctx.diagnostics, ...loaded.value.diagnostics, ...view.value.diagnostics];
  const data: DetectData = { reports, count: reports.length, unresolvable, diagnostics };
  const summary = reports.length === 0
    ? "No contradictions found."
    : `${reports.length} contradiction${reports.length === 1 ? "" : "s"} found; ${unresolvable} unresolvable.`;
  return ok(summary, data);
}
