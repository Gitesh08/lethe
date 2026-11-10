// Property (c): stamped engrams decay as exp(-n / (s0 * W)). Refs: Req 23.6, REQ-DEC-1, REQ-DEC-2
// Isolation of the commit term: scoring uses nowISO equal to the stamp's lastReinforcedAt, so the alpha (day) term is 0
// and deltaC == n exactly. Unprotected engrams only (W = wDefault = 1): spec-linked or pinned engrams are protected in
// core (`computeWeight`: W = wSpec comes together with the 0.50 floor), so a W = wSpec case cannot be reached without
// protection and is covered by the core decay properties instead.
import { DEFAULT_CONFIG, parseDocument, score, type EngramNode } from "@lethe/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseLedger } from "../src/load/ledger-file.js";
import { computeCheckpoint } from "../src/persist/checkpoint.js";
import { ZERO_CURSOR } from "../src/persist/ledger-cursor.js";
import { runProperty } from "./support/pbt-runner.js";

const EPS = 1e-12; // documented epsilon, tests only
const s0 = DEFAULT_CONFIG.s0;
const NO_BYTES = new Uint8Array(0);

const engramsArb: fc.Arbitrary<ReadonlyArray<EngramNode>> = fc
  .array(fc.constantFrom("*.ts", "src/**", "*.md", "none/**"), { minLength: 1, maxLength: 6 })
  .map((globs) => {
    const text = globs.map((g, i) => `## Rule ${i}\n<!-- lethe: globs=${g} -->\nBody text for rule ${i}.\n`).join("\n");
    const r = parseDocument("a.md", `# Doc\n\n${text}`, DEFAULT_CONFIG);
    return r.ok ? r.value.engrams : [];
  });

const isoArb = fc.integer({ min: 0, max: 4_000_000_000_000 }).map((ms) => new Date(ms).toISOString());

const expectedTier = (n: number): "hot" | "warm" | "crypt" => (n <= 2 ? "hot" : n <= 6 ? "warm" : "crypt");

describe("stamped decay (property c)", () => {
  it("stamped, unprotected engrams follow exp(-n/s0), monotone, with default tiers", () => {
    runProperty(
      "checkpoint-c",
      fc.property(
        engramsArb,
        fc.integer({ min: 0, max: 1_000_000 }),
        isoArb,
        fc.array(fc.integer({ min: 0, max: 200 }), { minLength: 1, maxLength: 12 }),
        (engrams, c0, nowISO, ns) => {
          fc.pre(engrams.length > 0);
          const cp = computeCheckpoint({
            engrams, persisted: [], persistedCursor: ZERO_CURSOR, ledger: parseLedger(NO_BYTES, ZERO_CURSOR),
            ledgerBytes: NO_BYTES, specs: [], cfg: DEFAULT_CONFIG, nowCommit: c0, nowISO, archivedIds: [], anySteeringSkipped: false,
          });
          expect(cp.stamped.length).toBe(engrams.length);
          let prev = new Map<string, number>();
          for (const n of [...ns].sort((a, b) => a - b)) {
            const scored = score({ engrams, states: cp.states, specs: [], ledger: [], nowCommit: c0 + n, nowISO, cfg: DEFAULT_CONFIG });
            expect(scored.length).toBe(engrams.length);
            for (const s of scored) {
              expect(s.protected).toBe(false);
              expect(Math.abs(s.retention - Math.exp(-n / s0))).toBeLessThanOrEqual(EPS);
              expect(s.tier).toBe(expectedTier(n));
              const before = prev.get(s.node.id);
              if (before !== undefined) expect(s.retention).toBeLessThanOrEqual(before);
            }
            prev = new Map(scored.map((s) => [s.node.id, s.retention]));
          }
        },
      ),
    );
  });
});
