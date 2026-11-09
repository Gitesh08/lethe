// fast-check arbitraries for LedgerEvent[] (REQ-PBT-4: bursty / empty / ordinary ledgers).
// Pools are exported so engram/workspace arbitraries can produce real glob/cite matches.

import fc from "fast-check";
import type { LedgerEvent } from "../../types.js";

export const FILE_POOL: readonly string[] = [
  "src/a.ts",
  "src/b.ts",
  "src/decay/retention.ts",
  "apps/web/x.tsx",
  "apps/web/components/canvas.tsx",
  "docs/readme.md",
  "docs/kiro-writeup.md",
  "packages/lethe-mcp/src/server.ts",
];

export const ENGRAM_ID_POOL: readonly string[] = [
  ".kiro/steering/03-rules.md#typescript",
  ".kiro/steering/03-rules.md#css",
  ".kiro/steering/02-architecture.md#web",
  ".kiro/steering/06-memory.md#locked-decisions",
  ".kiro/steering/legacy.md#state-management",
];

export const SPEC_NAME_POOL: readonly string[] = ["lethe-core", "lethe-mcp", "lethe-web-sandbox"];

export const CITE_POOL: readonly string[] = [...ENGRAM_ID_POOL, ...SPEC_NAME_POOL];

const EVENT_TYPES = ["task_passed", "spec_cited", "manual_pin"] as const;

/** ~year 2100 in ms; integer ms -> ISO so values are always valid (never fc.date). */
const MAX_MS = 4_102_444_800_000;

const isoArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: MAX_MS })
  .map((ms) => new Date(ms).toISOString());

const subsetArb = (pool: readonly string[]): fc.Arbitrary<readonly string[] | null> =>
  fc.option(fc.subarray([...pool], { minLength: 1 }), { nil: null, freq: 2 });

function buildEvent(
  type: LedgerEvent["type"],
  at: string,
  commit: number,
  files: readonly string[] | null,
  cited: readonly string[] | null,
): LedgerEvent {
  // Omit keys instead of assigning undefined (exactOptionalPropertyTypes).
  return {
    type,
    at,
    commit,
    ...(files === null ? {} : { filesTouched: files }),
    ...(cited === null ? {} : { cited }),
  };
}

function eventWithAt(commit: number, at: fc.Arbitrary<string>): fc.Arbitrary<LedgerEvent> {
  return fc
    .tuple(fc.constantFrom(...EVENT_TYPES), at, subsetArb(FILE_POOL), subsetArb(CITE_POOL))
    .map(([type, a, files, cited]) => buildEvent(type, a, commit, files, cited));
}

/** One LedgerEvent at the given commit counter. */
export const ledgerEventArb = (commit: number): fc.Arbitrary<LedgerEvent> =>
  eventWithAt(commit, isoArb);

function eventsAtCommits(commits: readonly number[]): fc.Arbitrary<LedgerEvent[]> {
  return fc.tuple(...commits.map((c) => ledgerEventArb(c)));
}

/** 0..30 events with non-decreasing commit counters (sorted increments). */
export const ledgerArb: fc.Arbitrary<LedgerEvent[]> = fc
  .tuple(fc.nat({ max: 1000 }), fc.array(fc.nat({ max: 5 }), { maxLength: 30 }))
  .chain(([start, increments]) => {
    const commits: number[] = [];
    let current = start;
    for (const inc of increments) {
      current += inc;
      commits.push(current);
    }
    return eventsAtCommits(commits);
  });

/** >= 20 events inside a commit window <= 5 with near-identical timestamps. */
export const burstyLedgerArb: fc.Arbitrary<LedgerEvent[]> = fc
  .tuple(
    fc.nat({ max: 1000 }),
    fc.integer({ min: 0, max: 5 }),
    fc.integer({ min: 0, max: MAX_MS - 10_000 }),
    fc.integer({ min: 20, max: 30 }),
  )
  .chain(([start, window, baseMs, count]) =>
    fc
      .array(fc.integer({ min: 0, max: window }), { minLength: count, maxLength: count })
      .chain((offsets) => {
        const commits = [...offsets].sort((a, b) => a - b).map((o) => start + o);
        const nearAt = fc.integer({ min: 0, max: 999 }).map((j) => new Date(baseMs + j).toISOString());
        return fc.tuple(...commits.map((c) => eventWithAt(c, nearAt)));
      }),
  );

export const emptyLedgerArb: fc.Arbitrary<LedgerEvent[]> = fc.constant([]);

/** Weighted mix of all ledger shapes. */
export const anyLedgerArb: fc.Arbitrary<LedgerEvent[]> = fc.oneof(
  { arbitrary: ledgerArb, weight: 6 },
  { arbitrary: burstyLedgerArb, weight: 2 },
  { arbitrary: emptyLedgerArb, weight: 1 },
);
