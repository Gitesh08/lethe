// Property (f): future-commit events stay unconsumed (with every later line) until a checkpoint reaches their commit.
// Fold results depend on nowCommit only through event selection: core `score` returns the reinforced state
// (reinforce() uses each event's own commit/at), so a chained run equals a one-shot run at the final commit.
// Validates: Req 23.3, Req 23.4
import { DEFAULT_CONFIG, type EngramNode, type EngramState } from "@lethe/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseLedger } from "../src/load/ledger-file.js";
import { computeCheckpoint } from "../src/persist/checkpoint.js";
import { ZERO_CURSOR, type LedgerCursor } from "../src/persist/ledger-cursor.js";
import { KEY_ORDERS, stableLine } from "../src/persist/stable-json.js";
import { runProperty } from "./support/pbt-runner.js";

const NOW_ISO = "2026-06-01T00:00:00.000Z";
const IDS = ["a", "b", "c"] as const;
const FILES = ["src/x.ts", "docs/r.md", "other.txt"] as const;
const GLOBS = ["src/*.ts", "**/*.md", "*.txt"] as const;
const MAX_COMMIT = 300;

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const iso = (ms: number): string => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();

const nodeOf = (id: string, globs: string[]): EngramNode => ({
  id, file: "a.md", headingPath: [id], body: id, contentHash: id, tokens: 1, globs, specLinks: [], pinned: false,
  span: { start: 0, end: 1 },
});

interface Item { readonly line: string; readonly commit: number | null } // commit null => noise

interface Scenario {
  readonly engrams: ReadonlyArray<EngramNode>;
  readonly states: ReadonlyArray<EngramState>;
  readonly items: ReadonlyArray<Item>;
  readonly thresholds: ReadonlyArray<number>; // ascending
}

const eventItem: fc.Arbitrary<Item> = fc
  .record({
    type: fc.constantFrom("task_passed", "spec_cited", "manual_pin"),
    atMs: fc.integer({ min: 0, max: 86_400_000 * 50 }),
    commit: fc.integer({ min: 0, max: MAX_COMMIT }),
    files: fc.subarray([...FILES]),
    cited: fc.subarray([...IDS]),
  })
  .map((e) => ({
    commit: e.commit,
    line: stableLine(
      { type: e.type, at: iso(e.atMs), commit: e.commit, ...(e.type === "task_passed" ? { filesTouched: e.files } : { cited: e.cited }) },
      KEY_ORDERS.ledgerLine,
    ),
  }));

const noiseItem: fc.Arbitrary<Item> = fc
  .constantFrom("\n", "garbage\n", "{not json}\n", "  \n", "\r\n")
  .map((line) => ({ line, commit: null }));

const scenario: fc.Arbitrary<Scenario> = fc
  .record({
    globsPer: fc.array(fc.subarray([...GLOBS]), { minLength: IDS.length, maxLength: IDS.length }),
    items: fc.array(fc.oneof({ weight: 4, arbitrary: eventItem }, { weight: 1, arbitrary: noiseItem }), { maxLength: 25 }),
    ts: fc.array(fc.integer({ min: 0, max: MAX_COMMIT }), { minLength: 2, maxLength: 2 }),
  })
  .map((r) => ({
    engrams: IDS.map((id, i) => nodeOf(id, [...(r.globsPer[i] ?? [])])),
    states: IDS.map((id) => ({ id, stability: 5, lastReinforcedCommit: 0, lastReinforcedAt: iso(0), reinforcements: 0 })),
    items: r.items,
    thresholds: [...r.ts].sort((a, b) => a - b),
  }));

function step(s: Scenario, text: string, persisted: ReadonlyArray<EngramState>, cursor: LedgerCursor, nowCommit: number) {
  const bytes = enc(text);
  return computeCheckpoint({
    engrams: s.engrams, persisted, persistedCursor: cursor, ledger: parseLedger(bytes, cursor), ledgerBytes: bytes,
    specs: [], cfg: DEFAULT_CONFIG, nowCommit, nowISO: NOW_ISO, archivedIds: [], anySteeringSkipped: false,
  });
}

/** Model: first index >= pos holding an event with commit > t, else n. */
function modelStop(items: ReadonlyArray<Item>, pos: number, t: number): number {
  for (let i = pos; i < items.length; i++) {
    const c = items[i]?.commit ?? null;
    if (c !== null && c > t) return i;
  }
  return items.length;
}

const countEvents = (items: ReadonlyArray<Item>, from: number, to: number): number =>
  items.slice(from, to).filter((i) => i.commit !== null).length;

function runChain(s: Scenario, thresholds: ReadonlyArray<number>): void {
  const text = s.items.map((i) => i.line).join("");
  let pos = 0;
  let states: ReadonlyArray<EngramState> = s.states;
  let cursor: LedgerCursor = ZERO_CURSOR;
  let folded = 0;
  for (const t of thresholds) {
    const stop = modelStop(s.items, pos, t);
    const r = step(s, text, states, cursor, t);
    expect(r.cursor.lines).toBe(stop);
    expect(r.foldedEvents).toBe(countEvents(s.items, pos, stop));
    // nothing at or after a future event was consumed
    expect(stop === s.items.length || (s.items[stop]?.commit ?? 0) > t).toBe(true);
    folded += r.foldedEvents;
    pos = stop;
    states = r.states;
    cursor = r.cursor;
  }
  expect(pos).toBe(s.items.length);
  expect(cursor.lines).toBe(s.items.length);
  expect(folded).toBe(countEvents(s.items, 0, s.items.length));
  const oneShot = step(s, text, s.states, ZERO_CURSOR, thresholds[thresholds.length - 1] ?? 0);
  expect(states).toEqual(oneShot.states);
  expect(cursor).toEqual(oneShot.cursor);
  expect(oneShot.foldedEvents).toBe(folded);
}

describe("checkpoint property (f): future-commit events", () => {
  it("two-step: c1 stops at first future event, c2 >= max consumes the rest exactly once", () => {
    runProperty(
      "checkpoint-f-2",
      fc.property(scenario, (s) => runChain(s, [s.thresholds[0] ?? 0, MAX_COMMIT])),
    );
  });

  it("three-step chain c1 <= c1' <= c2", () => {
    runProperty(
      "checkpoint-f-3",
      fc.property(scenario, (s) => runChain(s, [s.thresholds[0] ?? 0, s.thresholds[1] ?? 0, MAX_COMMIT])),
    );
  });

  it("example: noise after the first future event is not consumed", () => {
    const ev = (c: number): string => stableLine({ type: "task_passed", at: iso(1), commit: c, filesTouched: ["src/x.ts"] }, KEY_ORDERS.ledgerLine);
    const items: Item[] = [
      { line: "garbage\n", commit: null }, { line: ev(5), commit: 5 }, { line: ev(50), commit: 50 },
      { line: "\n", commit: null }, { line: ev(7), commit: 7 },
    ];
    const s: Scenario = {
      engrams: [nodeOf("a", ["src/*.ts"])],
      states: [{ id: "a", stability: 5, lastReinforcedCommit: 0, lastReinforcedAt: iso(0), reinforcements: 0 }],
      items, thresholds: [10, 60],
    };
    const r = step(s, items.map((i) => i.line).join(""), s.states, ZERO_CURSOR, 10);
    expect(r.cursor.lines).toBe(2);
    expect(r.foldedEvents).toBe(1);
    runChain(s, [10, 60]);
  });
});
