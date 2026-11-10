// Read-time checkpoint view shared by score, detect and sleep (design "State Model"). Never writes.
// Refs: Req 2.2, Req 2.4, Req 23.2, Req 23.5, Req 23.12, Req 23.13
import { ok, score, type LedgerEvent, type Result, type ScoredEngram } from "@lethe/core";
import { diagnostic, type Diagnostic } from "../envelope/diagnostics.js";
import type { ToolError } from "../envelope/errors.js";
import { LEDGER_REL } from "../load/ledger-file.js";
import type { LoadedWorkspace } from "../load/workspace.js";
import { computeCheckpoint, type CheckpointResult } from "../persist/checkpoint.js";
import { prefixEvents, selectPrefix } from "../persist/consumable-prefix.js";
import type { RunContext } from "./context.js";

export type FirstSeen = "persisted" | "synthesised";

export interface CheckpointView {
  /** Core-scored steering (+ spec when loaded) engrams, core order (tier, then id). */
  readonly scored: ReadonlyArray<ScoredEngram>;
  /** In-memory checkpoint (fold + stamps); what a write would persist. Not written here. */
  readonly checkpoint: CheckpointResult;
  /** Events after the Consumable_Prefix, file order; empty when the ledger was rewritten. */
  readonly unconsumedEvents: ReadonlyArray<LedgerEvent>;
  /** Every scored id -> whether its state came from state.json. Spec engrams are always "synthesised". */
  readonly firstSeen: ReadonlyMap<string, FirstSeen>;
  /** View diagnostics: FIRST_SEEN_SYNTHESISED, COMMIT_BEFORE_CHECKPOINT, checkpoint diagnostics
   *  except LEDGER_REWRITTEN (already present in `loaded.diagnostics`). */
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

/** Read-only: computes the checkpoint in memory, then scores once with folded states + unconsumed events. */
export async function checkpointView(ctx: RunContext, loaded: LoadedWorkspace): Promise<Result<CheckpointView, ToolError>> {
  const raw = await ctx.fsx.readBytes(LEDGER_REL);
  if (!raw.ok) return raw;
  const cp = computeCheckpoint({
    engrams: loaded.engrams,
    persisted: loaded.persisted.states,
    persistedCursor: loaded.persisted.cursor,
    ledger: loaded.ledger,
    ledgerBytes: raw.value ?? new Uint8Array(0),
    specs: loaded.specs,
    cfg: loaded.cfg,
    nowCommit: ctx.nowCommit,
    nowISO: ctx.nowISO,
    archivedIds: [],
    anySteeringSkipped: loaded.anySteeringSkipped,
  });
  const tail = loaded.ledger.rewritten ? [] : loaded.ledger.tail;
  const unconsumedEvents = prefixEvents(tail.slice(selectPrefix(tail, ctx.nowCommit).length));
  const scored = score({
    engrams: [...loaded.engrams, ...loaded.specEngrams],
    states: cp.states,
    specs: loaded.specs,
    ledger: unconsumedEvents,
    nowCommit: ctx.nowCommit,
    nowISO: ctx.nowISO,
    cfg: loaded.cfg,
  });
  const persistedIds = new Set(loaded.persisted.states.map((s) => s.id));
  const firstSeen = new Map<string, FirstSeen>();
  for (const s of scored) firstSeen.set(s.node.id, persistedIds.has(s.node.id) ? "persisted" : "synthesised");
  return ok({ scored, checkpoint: cp, unconsumedEvents, firstSeen, diagnostics: viewDiagnostics(ctx, loaded, cp) });
}

function viewDiagnostics(ctx: RunContext, loaded: LoadedWorkspace, cp: CheckpointResult): Diagnostic[] {
  const out: Diagnostic[] = cp.diagnostics.filter((d) => d.code !== "LEDGER_REWRITTEN");
  const before = loaded.persisted.commit;
  if (before !== undefined && ctx.nowCommit < before) {
    out.push(diagnostic("COMMIT_BEFORE_CHECKPOINT", `commit ${ctx.nowCommit} is before the last checkpoint at commit ${before}; scoring proceeds`));
  }
  const n = cp.stamped.length;
  if (n > 0) {
    out.push(diagnostic(
      "FIRST_SEEN_SYNTHESISED",
      `${n} steering engrams have no persisted state; their retention is 1 by construction until lethe adopt --apply, lethe record, or an apply stamps them.`,
    ));
  }
  return out;
}
