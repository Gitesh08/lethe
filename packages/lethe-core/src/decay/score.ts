// score(): join engrams + state + ledger, then decay -> retention -> tier.
//
// Design note: 02-architecture section 5 specifies `score(...) => ScoredEngram[]`,
// while REQ-NFR 6.6 wants a Result for out-of-contract input. We keep the
// architecture signature for score() (it assumes a valid cfg and sane
// nowCommit) and expose scoreChecked() as the total entry point for IO layers:
// it validates cfg / nowCommit and returns CONFIG_INVALID instead of scoring.
//
// Refs: REQ-DEC-1..7, REQ-DEC-11

import type {
  EngramNode,
  EngramState,
  LedgerEvent,
  LetheConfig,
  LetheError,
  Result,
  ScoredEngram,
  SpecInvariant,
  Tier,
} from "../types.js";
import { validateConfig } from "../config.js";
import { err, ok } from "../result.js";
import { computeDeltaC } from "./delta.js";
import { compileGlob, testGlob } from "./glob.js";
import { citesNode, prepareEvent, type PreparedEvent } from "./match-event.js";
import { reinforce } from "./reinforce.js";
import { computeRetention } from "./retention.js";
import { tierOf } from "./tier.js";
import { computeWeight } from "./weight.js";

export interface ScoreInput {
  readonly engrams: readonly EngramNode[];
  readonly states: readonly EngramState[];
  readonly specs: readonly SpecInvariant[];
  readonly ledger: readonly LedgerEvent[];
  readonly nowCommit: number;
  readonly nowISO: string;
  readonly cfg: LetheConfig;
}

const TIER_RANK: Readonly<Record<Tier, number>> = { hot: 0, warm: 1, crypt: 2 };

function compareScored(a: ScoredEngram, b: ScoredEngram): number {
  const ta = TIER_RANK[a.tier];
  const tb = TIER_RANK[b.tier];
  if (ta !== tb) return ta - tb;
  if (a.retention !== b.retention) return a.retention > b.retention ? -1 : 1;
  if (a.node.id !== b.node.id) return a.node.id < b.node.id ? -1 : 1;
  return 0;
}

function initialState(node: EngramNode, known: ReadonlyMap<string, EngramState>, i: ScoreInput): EngramState {
  return (
    known.get(node.id) ?? {
      id: node.id,
      stability: i.cfg.s0,
      lastReinforcedCommit: i.nowCommit,
      lastReinforcedAt: i.nowISO,
      reinforcements: 0,
    }
  );
}

/**
 * Per glob pattern: which events (by index) it matches. Computed lazily once per
 * distinct pattern, so glob tests cost O(distinct globs * events) instead of
 * O(engrams * globs * events). Only task_passed events can match via globs.
 * Result is identical to eventMatchesPrepared (see perf.score.test.ts).
 */
function globMatrix(events: readonly PreparedEvent[]): (pattern: string) => Uint8Array {
  const cache = new Map<string, Uint8Array>();
  return (pattern) => {
    const cached = cache.get(pattern);
    if (cached !== undefined) return cached;
    const row = new Uint8Array(events.length);
    const re = compileGlob(pattern);
    if (re !== null) {
      for (let k = 0; k < events.length; k += 1) {
        const pe = events[k];
        if (pe !== undefined && pe.ev.type === "task_passed" && pe.files.some((f) => testGlob(re, f))) row[k] = 1;
      }
    }
    cache.set(pattern, row);
    return row;
  };
}

function applyLedger(
  node: EngramNode,
  start: EngramState,
  events: readonly PreparedEvent[],
  cfg: LetheConfig,
  rowOf: (pattern: string) => Uint8Array,
): EngramState {
  const rows = node.globs.map(rowOf);
  let state = start;
  for (let k = 0; k < events.length; k += 1) {
    const pe = events[k];
    if (pe === undefined) continue;
    let hit = citesNode(node, pe.cited);
    for (let r = 0; !hit && r < rows.length; r += 1) hit = rows[r]?.[k] === 1;
    if (hit) state = reinforce(state, pe.ev, cfg);
  }
  return state;
}

function scoreOne(
  node: EngramNode,
  state: EngramState,
  i: ScoreInput,
): ScoredEngram {
  const { W, isProtected, floor } = computeWeight(node, i.specs, i.cfg);
  const deltaC = computeDeltaC(state, i.nowCommit, i.nowISO, i.cfg.alpha);
  const rawRetention = computeRetention(deltaC, state.stability, W, i.cfg.sMin);
  const retention = Math.max(rawRetention, floor);
  return {
    node,
    state,
    deltaC,
    weight: W,
    retention,
    rawRetention,
    tier: tierOf(retention, i.cfg),
    status: "active",
    protected: isProtected,
  };
}

/** Assumes a valid cfg. Use scoreChecked() at IO boundaries. */
export function score(input: ScoreInput): ScoredEngram[] {
  const known = new Map<string, EngramState>();
  for (const s of input.states) known.set(s.id, s);

  const events = input.ledger.filter((e) => e.commit <= input.nowCommit).map(prepareEvent);
  const rowOf = globMatrix(events);

  const out = input.engrams.map((node) => {
    const start = initialState(node, known, input);
    return scoreOne(node, applyLedger(node, start, events, input.cfg, rowOf), input);
  });
  return out.sort(compareScored);
}

/** Total entry point: validates cfg and nowCommit, then scores. */
export function scoreChecked(input: ScoreInput): Result<ScoredEngram[], LetheError> {
  const cfg = validateConfig(input.cfg);
  if (!cfg.ok) return err(cfg.error);
  if (!Number.isFinite(input.nowCommit) || input.nowCommit < 0) {
    return err({
      code: "CONFIG_INVALID",
      message: `nowCommit must be a finite number >= 0; got ${String(input.nowCommit)}`,
    });
  }
  return ok(score({ ...input, cfg: cfg.value }));
}
