// Pure sleep planning shared by the dry-run and the apply path (design "Sleep operation"; Req 4.2-4.4, 4.7).
// No IO, no lock, no clock: everything comes from the RunContext, the loaded workspace and the checkpoint view.
//
// API: planSleep(ctx, loaded, view, { ledgerBytes, budgetTokens? }) -> Result<SleepPlanned, ToolError>
//   - spec engrams are never planned or archived (steering files only);
//   - `budgetTokens` replaces config.json's value for this call only and is never part of any output text;
//   - `changedSteering`, `tombstonesText`, `stateText` are exactly what the apply path (7.7) hands to the write plan.
import {
  applyPlan, detectContradictions, err, ok, planConsolidation, serializeTombstones, validateConfig,
  type ApplyResult, type ConsolidationPlan, type ContradictionReport, type LetheConfig, type Result,
  type ScoredEngram, type SleepConsolidationResult,
} from "@lethe/core";
import type { Diagnostic } from "../envelope/diagnostics.js";
import { mapCoreError, type ToolError } from "../envelope/errors.js";
import type { LoadedWorkspace } from "../load/workspace.js";
import { computeCheckpoint, type CheckpointResult } from "../persist/checkpoint.js";
import { serializeState } from "../persist/state-serialize.js";
import type { PlannedWrite } from "../persist/write-plan.js";
import type { RunContext } from "./context.js";
import type { CheckpointView } from "./view.js";

export interface SleepPlanOptions {
  /** Raw ledger bytes (absent ledger = empty), needed to hash the last consumed line. */
  readonly ledgerBytes: Uint8Array;
  readonly budgetTokens?: number | undefined;
}

/** `SleepConsolidationResult` minus the two fields only the caller knows (gate outcome, write success). */
export type SleepCore = Omit<SleepConsolidationResult, "pbtGate" | "applied">;

export interface SleepPlanned {
  readonly cfg: LetheConfig;
  /** Steering engrams only, core order. */
  readonly scored: ReadonlyArray<ScoredEngram>;
  readonly reports: ReadonlyArray<ContradictionReport>;
  readonly plan: ConsolidationPlan;
  readonly applied: ApplyResult;
  readonly core: SleepCore;
  readonly skipped: ReadonlyArray<{ readonly id: string; readonly reason: string }>;
  /** Checkpoint recomputed with the archived ids removed; this is what the state write persists. */
  readonly checkpoint: CheckpointResult;
  readonly stateText: string;
  /** Steering files whose text differs after applyPlan, ascending path; never a neverRewrite path. */
  readonly changedSteering: ReadonlyArray<PlannedWrite>;
  /** Present only when something was buried (so an idle run never creates tombstones.json). */
  readonly tombstonesText?: string;
  /** loaded.diagnostics + view diagnostics (ctx.diagnostics not included). */
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function effectiveConfig(loaded: LoadedWorkspace, budgetTokens: number | undefined): Result<LetheConfig, ToolError> {
  if (budgetTokens === undefined) return ok(loaded.cfg);
  const v = validateConfig({ ...loaded.cfg, budgetTokens });
  return v.ok ? ok(v.value) : err(mapCoreError(v.error));
}

function assemble(plan: ConsolidationPlan, applied: ApplyResult, cfg: LetheConfig): SleepCore {
  const buried = new Set(applied.tombstones.map((t) => t.id));
  return {
    archived: applied.tombstones.filter((t) => t.reason !== "duplicate"),
    merged: plan.toMerge
      .filter((m) => buried.has(m.drop.node.id))
      .map((m) => ({ keep: m.keep.node.id, drop: m.drop.node.id })),
    demoted: plan.toDemote,
    tokensBefore: plan.tokensBefore,
    tokensAfter: plan.tokensAfter,
    budget: cfg.budgetTokens,
    budgetStatus: plan.budgetStatus,
  };
}

function changedFiles(loaded: LoadedWorkspace, applied: ApplyResult): PlannedWrite[] {
  const never = new Set(loaded.neverRewrite);
  const out: PlannedWrite[] = [];
  for (const [rel, content] of applied.workspace.files) {
    if (!never.has(rel) && loaded.steeringFiles.get(rel) !== content) out.push({ rel, content });
  }
  return out.sort((a, b) => byCodeUnit(a.rel, b.rel));
}

function finalCheckpoint(ctx: RunContext, loaded: LoadedWorkspace, cfg: LetheConfig, applied: ApplyResult, bytes: Uint8Array): CheckpointResult {
  return computeCheckpoint({
    engrams: loaded.engrams, persisted: loaded.persisted.states, persistedCursor: loaded.persisted.cursor,
    ledger: loaded.ledger, ledgerBytes: bytes, specs: loaded.specs, cfg,
    nowCommit: ctx.nowCommit, nowISO: ctx.nowISO,
    archivedIds: applied.tombstones.map((t) => t.id), anySteeringSkipped: loaded.anySteeringSkipped,
  });
}

export function planSleep(
  ctx: RunContext,
  loaded: LoadedWorkspace,
  view: CheckpointView,
  opts: SleepPlanOptions,
): Result<SleepPlanned, ToolError> {
  const cfg = effectiveConfig(loaded, opts.budgetTokens);
  if (!cfg.ok) return cfg;
  const scored = view.scored.filter((s) => loaded.steeringFiles.has(s.node.file));
  const reports = detectContradictions(scored, loaded.specs, loaded.ontology);
  if (!reports.ok) return err(mapCoreError(reports.error));
  const plan = planConsolidation(scored, reports.value, cfg.value);
  const workspace = { files: loaded.steeringFiles, tombstones: loaded.tombstones ?? [] };
  const applied = applyPlan(workspace, plan, ctx.nowCommit, ctx.nowISO, cfg.value);
  const checkpoint = finalCheckpoint(ctx, loaded, cfg.value, applied, opts.ledgerBytes);
  const stateText = serializeState({ commit: ctx.nowCommit, at: ctx.nowISO, ledger: checkpoint.cursor, engrams: checkpoint.states });
  return ok({
    cfg: cfg.value, scored, reports: reports.value, plan, applied,
    core: assemble(plan, applied, cfg.value),
    skipped: applied.skipped.map((s) => ({ id: s.id, reason: s.reason })),
    checkpoint, stateText,
    changedSteering: changedFiles(loaded, applied),
    ...(applied.tombstones.length > 0 ? { tombstonesText: serializeTombstones(applied.workspace.tombstones) } : {}),
    diagnostics: [...loaded.diagnostics, ...view.diagnostics],
  });
}
