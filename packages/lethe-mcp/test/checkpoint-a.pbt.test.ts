// Property (a): no double counting - folding a prefix then the remainder equals a one-shot replay.
// Validates: Req 23.2, Req 23.4, INV-4
import { DEFAULT_CONFIG, type EngramNode, type EngramState } from "@lethe/core";
import fc from "fast-check";
import { describe, it } from "vitest";
import { expect } from "vitest";
import { parseLedger } from "../src/load/ledger-file.js";
import { computeCheckpoint } from "../src/persist/checkpoint.js";
import { ZERO_CURSOR, type LedgerCursor } from "../src/persist/ledger-cursor.js";
import { KEY_ORDERS, stableLine } from "../src/persist/stable-json.js";
import { runProperty } from "./support/pbt-runner.js";

const NOW_COMMIT = 200;
const NOW_ISO = "2026-06-01T00:00:00.000Z";
const IDS = ["a.md#one", "a.md#two", "b.md#three", "B", "z"] as const;
const FILES = ["src/x.ts", "src/y.css", "docs/readme.md", "other.txt"] as const;
const GLOBS = ["src/*.ts", "**/*.md", "src/**", "*.txt"] as const;

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const nodeOf = (id: string, globs: string[]): EngramNode => ({
  id, file: "a.md", headingPath: [id], body: id, contentHash: id, tokens: 1, globs, specLinks: [], pinned: false,
  span: { start: 0, end: 1 },
});

const iso = (ms: number): string => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();

interface Scenario {
  readonly engrams: ReadonlyArray<EngramNode>;
  readonly states: ReadonlyArray<EngramState>;
  readonly lines: ReadonlyArray<string>; // each newline-terminated
  readonly split: number;
}

const eventLine = fc.record({
  type: fc.constantFrom("task_passed", "spec_cited", "manual_pin"),
  atMs: fc.integer({ min: 0, max: 86_400_000 * 100 }),
  files: fc.subarray([...FILES]),
  cited: fc.subarray([...IDS]),
});

const noiseLine = fc.constantFrom("\n", "garbage\n", "{not json}\n", "  \n", "\r\n");

const scenario: fc.Arbitrary<Scenario> = fc
  .record({
    globsPer: fc.array(fc.subarray([...GLOBS]), { minLength: IDS.length, maxLength: IDS.length }),
    stab: fc.array(fc.double({ min: 0.5, max: 120, noNaN: true }), { minLength: IDS.length, maxLength: IDS.length }),
    lastC: fc.array(fc.integer({ min: 0, max: 100 }), { minLength: IDS.length, maxLength: IDS.length }),
    reinf: fc.array(fc.integer({ min: 0, max: 5 }), { minLength: IDS.length, maxLength: IDS.length }),
    items: fc.array(
      fc.oneof(
        { weight: 4, arbitrary: eventLine.map((e) => ({ kind: "event" as const, e })) },
        { weight: 1, arbitrary: noiseLine.map((n) => ({ kind: "noise" as const, n })) },
      ),
      { maxLength: 25 },
    ),
    commitMode: fc.constantFrom("spread", "single"),
    commitDeltas: fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 25, maxLength: 25 }),
    dupEvery: fc.constantFrom(0, 0, 2, 3),
    splitFrac: fc.double({ min: 0, max: 1, noNaN: true }),
    splitEdge: fc.constantFrom("free", "free", "zero", "full"),
  })
  .map((r) => {
    let commit = 101;
    let ev = 0;
    const lines: string[] = [];
    for (const it of r.items) {
      if (it.kind === "noise") {
        lines.push(it.n);
        continue;
      }
      if (r.commitMode === "spread") commit = Math.min(NOW_COMMIT, commit + (r.commitDeltas[ev] ?? 0));
      const obj = {
        type: it.e.type, at: iso(it.e.atMs), commit,
        ...(it.e.type === "task_passed" ? { filesTouched: it.e.files } : { cited: it.e.cited }),
      };
      const l = stableLine(obj, KEY_ORDERS.ledgerLine);
      lines.push(l);
      if (r.dupEvery !== 0 && ev % r.dupEvery === 0) lines.push(l); // exact duplicate line
      ev++;
    }
    const n = lines.length;
    const split = r.splitEdge === "zero" ? 0 : r.splitEdge === "full" ? n : Math.floor(r.splitFrac * (n + 1)) % (n + 1);
    const engrams = IDS.map((id, i) => nodeOf(id, [...(r.globsPer[i] ?? [])]));
    const states: EngramState[] = IDS.map((id, i) => ({
      id, stability: r.stab[i] ?? 5, lastReinforcedCommit: r.lastC[i] ?? 0,
      lastReinforcedAt: iso((r.lastC[i] ?? 0) * 1000), reinforcements: r.reinf[i] ?? 0,
    }));
    return { engrams, states, lines, split };
  });

function step(s: Scenario, text: string, persisted: ReadonlyArray<EngramState>, cursor: LedgerCursor) {
  const bytes = enc(text);
  return computeCheckpoint({
    engrams: s.engrams, persisted, persistedCursor: cursor, ledger: parseLedger(bytes, cursor), ledgerBytes: bytes,
    specs: [], cfg: DEFAULT_CONFIG, nowCommit: NOW_COMMIT, nowISO: NOW_ISO, archivedIds: [], anySteeringSkipped: false,
  });
}

describe("checkpoint property (a): no double counting", () => {
  it("fold(prefix) then replay(remainder) equals one-shot replay", () => {
    runProperty(
      "checkpoint-a",
      fc.property(scenario, (s) => {
        const all = s.lines.join("");
        const first = step(s, s.lines.slice(0, s.split).join(""), s.states, ZERO_CURSOR);
        const second = step(s, all, first.states, first.cursor);
        const oneShot = step(s, all, s.states, ZERO_CURSOR);
        expect(second.states).toEqual(oneShot.states);
        expect(second.cursor).toEqual(oneShot.cursor);
        expect(first.foldedEvents + second.foldedEvents).toBe(oneShot.foldedEvents);
      }),
    );
  });

  it("adversarial: all events at one commit with duplicates, split in the middle", () => {
    const l = stableLine({ type: "task_passed", at: iso(5), commit: 150, filesTouched: ["src/x.ts"] }, KEY_ORDERS.ledgerLine);
    const lines = [l, l, "garbage\n", l, "\n", l];
    const globs = ["src/*.ts"];
    const s: Scenario = {
      engrams: [nodeOf("a", globs)],
      states: [{ id: "a", stability: 5, lastReinforcedCommit: 0, lastReinforcedAt: iso(0), reinforcements: 0 }],
      lines, split: 3,
    };
    const first = step(s, lines.slice(0, 3).join(""), s.states, ZERO_CURSOR);
    const second = step(s, lines.join(""), first.states, first.cursor);
    const one = step(s, lines.join(""), s.states, ZERO_CURSOR);
    expect(second.states).toEqual(one.states);
    expect(second.cursor).toEqual(one.cursor);
    expect(one.states[0]?.reinforcements).toBe(4);
  });
});
