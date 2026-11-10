// adoptOp (design "Adopt and record"; Req 23.11, Req 10.7): report the checkpoint; with apply write only state.json.
import { ok, type Result } from "@lethe/core";
import type { ToolError } from "../envelope/errors.js";
import { loadWorkspace } from "../load/workspace.js";
import type { RunContext } from "./context.js";
import { computeCheckpointStep, readLedgerBytes, runCheckpointStep } from "./checkpoint-step.js";
import { withMutation } from "./mutate.js";
import type { CheckpointResult } from "../persist/checkpoint.js";

export interface AdoptData {
  readonly stamped: ReadonlyArray<string>;
  readonly foldedEvents: number;
  readonly pruned: ReadonlyArray<string>;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function toData(r: CheckpointResult): AdoptData {
  return { stamped: [...r.stamped].sort(byCodeUnit), foldedEvents: r.foldedEvents, pruned: [...r.pruned].sort(byCodeUnit) };
}

/** Concise human summary for the CLI/envelope. */
export function adoptSummary(d: AdoptData, apply: boolean): string {
  const counts = `${d.stamped.length} stamped, ${d.foldedEvents} events folded, ${d.pruned.length} pruned`;
  return apply ? `Adopted: ${counts}; state.json updated.` : `Dry run: would adopt ${counts}. Re-run with --apply to write state.json.`;
}

export async function adoptOp(ctx: RunContext, input: { readonly apply: boolean }): Promise<Result<AdoptData, ToolError>> {
  if (input.apply) {
    return withMutation(ctx, async (loaded) => {
      const step = await runCheckpointStep(ctx, loaded);
      if (!step.ok) return step;
      ctx.diagnostics.push(...step.value.result.diagnostics);
      return ok(toData(step.value.result));
    });
  }
  const loaded = await loadWorkspace(ctx.fsx, { includeSpecs: true, needTombstones: true });
  if (!loaded.ok) return loaded;
  const bytes = await readLedgerBytes(ctx);
  if (!bytes.ok) return bytes;
  const { result } = computeCheckpointStep(loaded.value, ctx, bytes.value);
  ctx.diagnostics.push(...result.diagnostics);
  return ok(toData(result));
}
