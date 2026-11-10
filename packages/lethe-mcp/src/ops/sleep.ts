// sleepOp (design "Sleep operation"; Req 4.2-4.5, 4.7, 14.1, 14.2). This file holds the op entry and the
// dry-run path; the pure planning is in sleep-plan.ts and is shared with the apply path (task 7.7).
//
// Dry-run: no lock, no write, except a gate failure which is recorded to pbt-failures.json under the lock
// (Req 14.4). The gate (when not skipped) runs through the injected `ctx.gate`.
import { err, ok, type Result, type SleepConsolidationResult } from "@lethe/core";
import type { Diagnostic } from "../envelope/diagnostics.js";
import { fromUnknown, toolError, type ToolError } from "../envelope/errors.js";
import { loadPbtFailureCore } from "../gate/gate.js";
import { recordPbtFailure, writePbtFailure, type GateFailure } from "../persist/pbt-failures.js";
import { buildWritePlan, executeWritePlan } from "../persist/write-plan.js";
import { withMutation } from "./mutate.js";
import type { CommitSource } from "../load/commit-counter.js";
import { loadWorkspace } from "../load/workspace.js";
import type { RunContext } from "./context.js";
import { readLedgerBytes } from "./checkpoint-step.js";
import { planSleep, type SleepPlanned } from "./sleep-plan.js";
import { checkpointView } from "./view.js";

export interface SleepOpInput {
  readonly apply: boolean;
  readonly skipGate: boolean;
  readonly gateRuns: number;
  readonly budgetTokens?: number | undefined;
}

export interface SleepData extends SleepConsolidationResult {
  readonly commit: number;
  readonly commitSource: CommitSource;
  readonly now: string;
  readonly skipped: ReadonlyArray<{ readonly id: string; readonly reason: string }>;
  readonly checkpoint: {
    readonly stamped: ReadonlyArray<string>;
    readonly foldedEvents: number;
    readonly pruned: ReadonlyArray<string>;
  };
  readonly gateFailure?: { readonly propertyId: string; readonly seed: number; readonly counterexample: unknown };
  readonly backupPath?: string;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

/** Gate result as the result assembly needs it. */
export interface GateVerdict {
  readonly pbtGate: SleepConsolidationResult["pbtGate"];
  readonly failure?: GateFailure;
}

/** Req 4.5 (checked before any work, also before loading). */
export function validateSleepInput(input: SleepOpInput): ToolError | undefined {
  return input.apply && input.skipGate
    ? toolError("INVALID_INPUT", "skipGate cannot be combined with apply: a gate-less apply is refused.")
    : undefined;
}

/** Result assembly shared by dry-run and apply. `applied` and `backupPath` are the caller's to set. */
export function buildSleepData(
  ctx: RunContext,
  planned: SleepPlanned,
  verdict: GateVerdict,
  extra: { readonly applied: boolean; readonly backupPath?: string | undefined },
): SleepData {
  const { checkpoint } = planned;
  const failure = verdict.failure;
  return {
    ...planned.core,
    pbtGate: verdict.pbtGate,
    applied: extra.applied,
    commit: ctx.nowCommit,
    commitSource: ctx.commitSource,
    now: ctx.nowISO,
    skipped: planned.skipped,
    checkpoint: { stamped: checkpoint.stamped, foldedEvents: checkpoint.foldedEvents, pruned: checkpoint.pruned },
    ...(failure === undefined ? {} : { gateFailure: { propertyId: failure.propertyId, seed: failure.seed, counterexample: failure.counterexample } }),
    ...(extra.backupPath === undefined ? {} : { backupPath: extra.backupPath }),
    diagnostics: [...ctx.diagnostics, ...planned.diagnostics],
  };
}

/** Human summary; always names `budget_infeasible` when it applies (Req 4.7). */
export function sleepSummary(d: SleepData): string {
  const lead = d.applied ? "Applied" : "Dry run";
  const parts = [
    `${lead}: ${d.archived.length} archived, ${d.merged.length} merged, ${d.demoted.length} demoted`,
    `hot tokens ${d.tokensBefore} -> ${d.tokensAfter} (budget ${d.budget}, ${d.budgetStatus})`,
    `gate ${d.pbtGate}`,
  ];
  if (d.budgetStatus === "budget_infeasible") parts.push("budget_infeasible: protected engrams exceed the budget and were kept");
  if (d.skipped.length > 0) parts.push(`${d.skipped.length} skipped`);
  return `${parts.join("; ")}.`;
}

async function runGate(ctx: RunContext, planned: SleepPlanned, input: SleepOpInput): Promise<Result<GateVerdict, ToolError>> {
  if (input.skipGate) return ok({ pbtGate: "skipped" });
  try {
    const out = await ctx.gate(planned.cfg, input.gateRuns);
    return ok(out.status === "passed" ? { pbtGate: "passed" } : { pbtGate: "failed", failure: out.failure });
  } catch (e) {
    return err(fromUnknown(e, ctx.log));
  }
}

async function dryRun(ctx: RunContext, input: SleepOpInput): Promise<Result<SleepData, ToolError>> {
  const loaded = await loadWorkspace(ctx.fsx, { includeSpecs: true, needTombstones: true });
  if (!loaded.ok) return loaded;
  const view = await checkpointView(ctx, loaded.value);
  if (!view.ok) return view;
  const bytes = await readLedgerBytes(ctx);
  if (!bytes.ok) return bytes;
  const planned = planSleep(ctx, loaded.value, view.value, { ledgerBytes: bytes.value, budgetTokens: input.budgetTokens });
  if (!planned.ok) return planned;
  const verdict = await runGate(ctx, planned.value, input);
  if (!verdict.ok) return verdict;
  if (verdict.value.failure !== undefined) {
    // Req 14.4: the failure record is the only file a dry-run may write (takes the lock itself).
    const rec = await recordPbtFailure(ctx.fsx, ctx.lock, await loadPbtFailureCore(), verdict.value.failure, ctx.nowISO);
    if (!rec.ok) ctx.log(`could not record pbt failure: ${rec.error.message}`);
  }
  return ok(buildSleepData(ctx, planned.value, verdict.value, { applied: false }));
}

/** Records a gate failure (lock already held) and returns PBT_GATE_FAILED; a record error is logged, not masked. */
async function failGate(ctx: RunContext, failure: GateFailure): Promise<Result<SleepData, ToolError>> {
  const rec = await writePbtFailure(ctx.fsx, await loadPbtFailureCore(), failure, ctx.nowISO);
  if (!rec.ok) ctx.log(`could not record pbt failure: ${rec.error.message}`);
  return err(
    toolError("PBT_GATE_FAILED", `PBT gate failed on ${failure.propertyId}; nothing was written.`, {
      propertyId: failure.propertyId,
      seed: failure.seed,
      counterexample: failure.counterexample,
      message: failure.message,
    }),
  );
}

/** Apply order: validate (caller), lock, recover, load, plan, gate, backup, write, release (Req 4.6, 14.2-14.4). */
async function applyPath(ctx: RunContext, input: SleepOpInput): Promise<Result<SleepData, ToolError>> {
  const step = ctx.trace ?? (() => undefined);
  return withMutation(ctx, async (loaded) => {
    step("plan");
    const view = await checkpointView(ctx, loaded);
    if (!view.ok) return view;
    const bytes = await readLedgerBytes(ctx);
    if (!bytes.ok) return bytes;
    const planned = planSleep(ctx, loaded, view.value, { ledgerBytes: bytes.value, budgetTokens: input.budgetTokens });
    if (!planned.ok) return planned;
    step("gate");
    const verdict = await runGate(ctx, planned.value, input);
    if (!verdict.ok) return verdict;
    if (verdict.value.failure !== undefined) return failGate(ctx, verdict.value.failure);
    const p = planned.value;
    const writes = buildWritePlan({
      ...(p.tombstonesText === undefined ? {} : { tombstones: p.tombstonesText }),
      steering: p.changedSteering,
      state: p.stateText,
    });
    step("backup");
    step("write");
    const out = await executeWritePlan({ fs: ctx.fsx, commit: ctx.nowCommit, nowISO: ctx.nowISO, pid: process.pid }, writes);
    if (!out.ok) return out;
    return ok(buildSleepData(ctx, p, verdict.value, { applied: true, backupPath: out.value.backupPath }));
  });
}

export async function sleepOp(ctx: RunContext, input: SleepOpInput): Promise<Result<SleepData, ToolError>> {
  const invalid = validateSleepInput(input);
  if (invalid !== undefined) return err(invalid);
  return input.apply ? applyPath(ctx, input) : dryRun(ctx, input);
}
