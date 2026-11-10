// Pure checkpoint computation: fold, stamp, prune, advance cursor. Refs: Req 23.1, Req 23.3, Req 23.7, Req 23.9
// COMMIT_BEFORE_CHECKPOINT (Req 23.13) is raised by the score tool, not here.
import { score, type EngramNode, type EngramState, type LedgerEvent, type LetheConfig, type SpecInvariant } from "@lethe/core";
import { diagnostic, type Diagnostic } from "../envelope/diagnostics.js";
import type { LedgerRead } from "../load/ledger-file.js";
import { consumePrefix } from "./consumable-prefix.js";
import type { LedgerCursor } from "./ledger-cursor.js";

export interface CheckpointInput {
  readonly engrams: ReadonlyArray<EngramNode>; // steering engrams only
  readonly persisted: ReadonlyArray<EngramState>;
  readonly persistedCursor: LedgerCursor;
  readonly ledger: LedgerRead; // parsed against persistedCursor
  readonly ledgerBytes: Uint8Array; // raw ledger bytes, used to hash the last consumed line
  readonly specs: ReadonlyArray<SpecInvariant>;
  readonly cfg: LetheConfig;
  readonly nowCommit: number;
  readonly nowISO: string;
  readonly archivedIds: ReadonlyArray<string>;
  readonly anySteeringSkipped: boolean;
}

export interface CheckpointResult {
  readonly states: ReadonlyArray<EngramState>; // ascending id (code units)
  readonly cursor: LedgerCursor;
  readonly stamped: ReadonlyArray<string>;
  readonly foldedEvents: number;
  readonly pruned: ReadonlyArray<string>;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function runScore(i: CheckpointInput, engrams: ReadonlyArray<EngramNode>, states: ReadonlyArray<EngramState>, ledger: ReadonlyArray<LedgerEvent>): EngramState[] {
  if (engrams.length === 0) return [];
  return score({ engrams, states, specs: i.specs, ledger, nowCommit: i.nowCommit, nowISO: i.nowISO, cfg: i.cfg }).map((s) => s.state);
}

export function computeCheckpoint(input: CheckpointInput): CheckpointResult {
  const diagnostics: Diagnostic[] = [];
  const archived = new Set(input.archivedIds);
  const live = input.engrams.filter((e) => !archived.has(e.id));
  const persistedIds = new Set(input.persisted.map((s) => s.id));
  const withState = live.filter((e) => persistedIds.has(e.id));
  const fresh = live.filter((e) => !persistedIds.has(e.id));

  let events: ReadonlyArray<LedgerEvent> = [];
  let cursor = input.persistedCursor;
  if (input.ledger.rewritten) {
    cursor = input.ledger.endCursor;
    diagnostics.push(diagnostic("LEDGER_REWRITTEN", "ledger does not match the state cursor; cursor re-anchored without folding events"));
  } else {
    const p = consumePrefix(input.ledger, input.persistedCursor, input.ledgerBytes, input.nowCommit);
    events = p.events;
    cursor = p.cursor;
  }

  const folded = runScore(input, withState, input.persisted, events);
  const stamps = runScore(input, fresh, [], []);
  const liveIds = new Set(input.engrams.map((e) => e.id));
  const carried = input.persisted.filter((s) => !archived.has(s.id) && !liveIds.has(s.id) && input.anySteeringSkipped);
  const pruned = input.persisted
    .filter((s) => archived.has(s.id) || (!liveIds.has(s.id) && !input.anySteeringSkipped))
    .map((s) => s.id)
    .sort(byCodeUnit);
  const states = [...folded, ...stamps, ...carried].sort((a, b) => byCodeUnit(a.id, b.id));
  const stamped = stamps.map((s) => s.id).sort(byCodeUnit);
  return { states, cursor, stamped, foldedEvents: events.length, pruned, diagnostics };
}
