// Per-engram saved state for the haunted repo, derived from each entry's Role.
// The states are a snapshot that the ledger is replayed on top of (see haunted-ledger.ts):
// ledger-reinforced roles start from a fresh baseline, the rest are placed so that their
// retention lands in the intended tier at NOW_COMMIT. Refs: REQ-SBX-1

import type { EngramState, LetheConfig } from "../types.js";
import { DAYS_PER_COMMIT, NOW_COMMIT, isoAtCommit } from "./haunted-clock.js";
import type { Entry, Role } from "./haunted-entry.js";
import type { Rng } from "./haunted-rng.js";

/** Decay-clock units per elapsed commit: 1 commit + alpha * (days per commit). */
function clockFactor(cfg: LetheConfig): number {
  return 1 + cfg.alpha * DAYS_PER_COMMIT;
}

function stabilityAfter(cfg: LetheConfig, reinforcements: number): number {
  return Math.min(cfg.s0 * Math.pow(1 + cfg.beta, reinforcements), cfg.sMax);
}

function make(id: string, stability: number, commit: number, reinforcements: number): EngramState {
  return {
    id,
    stability,
    lastReinforcedCommit: commit,
    lastReinforcedAt: isoAtCommit(commit),
    reinforcements,
  };
}

/** State whose retention at NOW_COMMIT is ~`target` (weight 1, so unprotected). */
function atRetention(id: string, cfg: LetheConfig, reinforcements: number, target: number): EngramState {
  const s = stabilityAfter(cfg, reinforcements);
  const age = Math.max(0, Math.round((-Math.log(target) * s) / clockFactor(cfg)));
  return make(id, s, Math.max(0, NOW_COMMIT - age), reinforcements);
}

/** Retention inside the Warm band: u=0 -> just above cryptMax, u=1 -> just below hotMin. */
function warmTarget(cfg: LetheConfig, u: number): number {
  return cfg.cryptMax + (cfg.hotMin - cfg.cryptMax) * u;
}

function hotTarget(cfg: LetheConfig, u: number): number {
  return cfg.hotMin + (1 - cfg.hotMin) * u;
}

function stateFor(role: Role, id: string, cfg: LetheConfig, rng: Rng): EngramState {
  switch (role) {
    case "pinHot":
    case "liveHot":
      return make(id, cfg.s0, rng.int(10, 40), 0);
    case "pinFloor":
      return make(id, cfg.s0, rng.int(5, 25), 0);
    case "warm":
      return atRetention(id, cfg, rng.int(2, 4), warmTarget(cfg, rng.range(0.25, 0.75)));
    case "dupKeep":
      return atRetention(id, cfg, 3, warmTarget(cfg, rng.range(0.55, 0.7)));
    case "dupDrop":
      return atRetention(id, cfg, 3, warmTarget(cfg, rng.range(0.3, 0.4)));
    case "loserHot":
      return atRetention(id, cfg, 4, hotTarget(cfg, rng.range(0.4, 0.8)));
    case "stale": {
      const k = rng.int(0, 2);
      return make(id, stabilityAfter(cfg, k), Math.max(0, NOW_COMMIT - rng.int(70, 140)), k);
    }
  }
}

/** One state per entry, in authored order; `idOf` supplies each entry's engram id. */
export function buildStates(
  entries: readonly Entry[],
  idOf: (entry: Entry) => string,
  cfg: LetheConfig,
  rng: Rng,
): EngramState[] {
  return entries.map((entry) => stateFor(entry.role, idOf(entry), cfg, rng));
}
