// Task ledger for the haunted repo: ~60 events over 150 commits / 60 days.
// Anchor events in the last ~30 commits guarantee that ledger-reinforced engrams are Hot;
// seeded filler events add history. Refs: REQ-SBX-1

import type { LedgerEvent } from "../types.js";
import { isoAtCommit } from "./haunted-clock.js";
import { nth } from "./haunted-rng.js";
import type { Rng } from "./haunted-rng.js";

const WEB = [
  "apps/web/components/Canvas.tsx",
  "apps/web/styles/tokens.css",
  "apps/web/lib/store.ts",
  "apps/web/lib/store.test.ts",
];
const CORE = [
  "packages/lethe-core/src/decay/score.ts",
  "packages/lethe-core/test/decay.pbt.test.ts",
  "packages/lethe-core/src/contradiction/detect.ts",
  "packages/lethe-core/src/consolidate/plan.ts",
];
const MCP = [
  "packages/lethe-mcp/src/server.ts",
  "packages/lethe-mcp/src/io/atomic-write.ts",
  "packages/lethe-mcp/src/tools/lethe-score.ts",
  ".kiro/hooks/lethe-check-on-save.json",
];
const AREAS: readonly (readonly string[])[] = [WEB, CORE, MCP];
const ANCHOR_COMMITS = [118, 126, 134, 140, 144, 148];

function taskPassed(commit: number, files: readonly string[]): LedgerEvent {
  return { type: "task_passed", at: isoAtCommit(commit), commit, filesTouched: files };
}

/** Six late task_passed events per area touching its first two files (source + test/style). */
function anchorEvents(rng: Rng): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  AREAS.forEach((pool, area) => {
    for (const base of ANCHOR_COMMITS) {
      const commit = base - area - rng.int(0, 1);
      out.push(taskPassed(commit, [nth(pool, 0, ""), nth(pool, 1, "")]));
    }
  });
  return out;
}

function fillerEvents(rng: Rng): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (let i = 0; i < 30; i += 1) {
    const commit = rng.int(2, 140);
    const pool = nth(AREAS, rng.int(0, AREAS.length - 1), WEB);
    const start = rng.int(0, pool.length - 1);
    const count = rng.int(1, 2);
    const files = Array.from({ length: count }, (_, k) => nth(pool, start + k, ""));
    out.push(taskPassed(commit, files));
  }
  return out;
}

function specEvents(rng: Rng, specNames: readonly string[]): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const name of specNames) {
    for (const base of [96, 124, 145]) {
      const commit = base + rng.int(0, 2);
      out.push({ type: "spec_cited", at: isoAtCommit(commit), commit, cited: [name] });
    }
  }
  return out;
}

function pinEvents(pinTargets: readonly string[]): LedgerEvent[] {
  return pinTargets.map((id, i) => {
    const commit = 88 + i * 24;
    return { type: "manual_pin" as const, at: isoAtCommit(commit), commit, cited: [id] };
  });
}

/** Chronological (commit ascending, stable) ledger. Consumes the rng in a fixed order. */
export function buildLedger(
  rng: Rng,
  specNames: readonly string[],
  pinTargets: readonly string[],
): LedgerEvent[] {
  const all = [
    ...anchorEvents(rng),
    ...fillerEvents(rng),
    ...specEvents(rng, specNames),
    ...pinEvents(pinTargets),
  ];
  return all
    .map((event, order) => ({ event, order }))
    .sort((a, b) => a.event.commit - b.event.commit || a.order - b.order)
    .map((x) => x.event);
}
