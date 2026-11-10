// Property (d): resurrected engrams are not boosted by old events. Refs: Req 23.1, Req 5.5, INV-3
// Mechanism (design "State Model", step 4): engrams without persisted state are stamped by a score call
// with states=[] and ledger=[]; the consumed prefix (every event with commit <= nowCommit) is folded only
// onto engrams that HAVE a persisted state. So events older than the resurrection commit r never touch the
// fresh stamp, whether the cursor already passed them or they are still unconsumed.
// Retention: the stamp's lastReinforcedAt equals nowISO, so the alpha day term is 0 when scoring at
// (r + n, same nowISO); W = 1 (unprotected, no specs). R = exp(-n / s0).
import { DEFAULT_CONFIG, parseDocument, score, sha256, type EngramNode, type EngramState } from "@lethe/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseLedger } from "../src/load/ledger-file.js";
import { computeCheckpoint } from "../src/persist/checkpoint.js";
import { ZERO_CURSOR, type LedgerCursor } from "../src/persist/ledger-cursor.js";
import { runProperty } from "./support/pbt-runner.js";

const NOW_ISO = "2026-06-01T00:00:00.000Z";
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const doc = parseDocument("a.md", "# Doc\n\n## Target\n<!-- lethe: globs=*.ts -->\nBody.\n\n## Other\n<!-- lethe: globs=*.ts -->\nBody two.\n", DEFAULT_CONFIG);
const nodes: ReadonlyArray<EngramNode> = doc.ok ? doc.value.engrams : [];
const target = nodes[0];
const other = nodes[1];

const eventLine = (commit: number, type: string, cite: boolean): string =>
  `${JSON.stringify(cite ? { type, at: "2026-02-01T00:00:00.000Z", commit, cited: [target?.id ?? ""] } : { type, at: "2026-02-01T00:00:00.000Z", commit, filesTouched: ["x.ts"] })}\n`;

const scenarioArb = fc.record({
  r: fc.integer({ min: 1, max: 500 }),
  n: fc.integer({ min: 0, max: 400 }),
  old: fc.array(fc.tuple(fc.nat({ max: 10_000 }), fc.constantFrom("task_passed", "manual_pin", "spec_cited"), fc.boolean()), { minLength: 1, maxLength: 8 }),
  consumed: fc.boolean(),
});

function cursorAfter(lines: ReadonlyArray<string>): LedgerCursor {
  if (lines.length === 0) return ZERO_CURSOR;
  return { lines: lines.length, bytes: enc(lines.join("")).length, lastLineSha256: sha256(lines[lines.length - 1] ?? "") };
}

describe("resurrected engrams are not boosted by old events (property d)", () => {
  it("fresh stamp ignores events older than the stamp commit; retention = exp(-n/s0)", () => {
    expect(target).toBeDefined();
    expect(other).toBeDefined();
    if (target === undefined || other === undefined) return;
    runProperty(
      "checkpoint-d",
      fc.property(scenarioArb, (s) => {
        const lines = s.old.map(([c, t, cite]) => eventLine(c % s.r, t, cite));
        const bytes = enc(lines.join(""));
        const cursor = s.consumed ? cursorAfter(lines) : ZERO_CURSOR;
        // `other` keeps its state; `target` was archived (absent) and reappears at commit r.
        const otherState: EngramState = { id: other.id, stability: 5, lastReinforcedCommit: 0, lastReinforcedAt: "2026-01-01T00:00:00.000Z", reinforcements: 0 };
        const res = computeCheckpoint({
          engrams: [target, other], persisted: [otherState], persistedCursor: cursor, ledger: parseLedger(bytes, cursor), ledgerBytes: bytes,
          specs: [], cfg: DEFAULT_CONFIG, nowCommit: s.r, nowISO: NOW_ISO, archivedIds: [], anySteeringSkipped: false,
        });
        const stamp = res.states.find((x) => x.id === target.id);
        expect(res.stamped).toEqual([target.id]);
        expect(stamp).toEqual({ id: target.id, stability: DEFAULT_CONFIG.s0, lastReinforcedCommit: s.r, lastReinforcedAt: NOW_ISO, reinforcements: 0 });
        // Unconsumed old events were folded (onto `other` only), and the cursor passed all of them.
        expect(res.foldedEvents).toBe(s.consumed ? 0 : lines.length);
        const at = score({ engrams: [target], states: stamp === undefined ? [] : [stamp], specs: [], ledger: [], nowCommit: s.r + s.n, nowISO: NOW_ISO, cfg: DEFAULT_CONFIG })[0];
        expect(Math.abs((at?.retention ?? -1) - Math.exp(-s.n / DEFAULT_CONFIG.s0))).toBeLessThanOrEqual(1e-12);
      }),
    );
  });
});
