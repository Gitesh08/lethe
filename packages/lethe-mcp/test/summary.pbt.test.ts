// Property: summary normaliser. Refs: Req 1.3
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normaliseSummary, SUMMARY_MAX_CHARS } from "../src/envelope/envelope.js";
import { runProperty } from "./support/pbt-runner.js";

const ELLIPSIS = "\u2026";
const cpLen = (s: string): number => Array.from(s).length;

const WS = ["\n", "\r", "\r\n", " ", "\t", "\u2028", "\u2029", "\u0085", "\u00a0", "\u3000"];
const wsRun = fc.array(fc.constantFrom(...WS), { minLength: 1, maxLength: 12 }).map((a) => a.join(""));
const astral = fc.constantFrom("😀", "👻", "\u{1F9DF}", "\u{20BB7}", "\u{1D11E}", "👨‍👩‍👧");
const combining = fc.constantFrom("e\u0301", "a\u0308", "\u0301", "n\u0303");
const word = fc.oneof(fc.string({ maxLength: 8 }), fc.fullUnicodeString({ maxLength: 8 }), astral, combining);

const mixed = fc
  .array(fc.oneof(word, wsRun), { maxLength: 150 })
  .map((a) => a.join(""));
const onlyWs = wsRun;
const long = fc
  .tuple(fc.fullUnicodeString({ minLength: 1, maxLength: 20 }), fc.integer({ min: 30, max: 120 }))
  .map(([s, n]) => `${s} `.repeat(n));
const atBoundary = fc
  .tuple(fc.constantFrom(398, 399, 400, 401, 402), fc.constantFrom("a", "😀", "é"), fc.boolean())
  .map(([n, ch, spaced]) => (spaced ? `${ch} `.repeat(n) : ch.repeat(n)));
const endsEllipsis = fc.oneof(mixed, atBoundary).map((s) => s + ELLIPSIS);
const crlfRuns = fc
  .array(fc.oneof(fc.string({ maxLength: 5 }), fc.constant("\r\n\r\n\r\n")), { maxLength: 100 })
  .map((a) => a.join(""));

const inputs = fc.oneof(
  fc.string(),
  fc.fullUnicodeString(),
  mixed,
  onlyWs,
  long,
  atBoundary,
  endsEllipsis,
  crlfRuns,
);

describe("normaliseSummary properties (Req 1.3)", () => {
  it("bounded, single-line, trimmed", () => {
    runProperty(
      "summary-shape",
      fc.property(inputs, (s) => {
        const out = normaliseSummary(s);
        expect(cpLen(out)).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
        expect(out).not.toMatch(/[\n\r]/);
        expect(out).toBe(out.trim());
      }),
    );
  });

  it("ends with the cut marker only when the input was cut", () => {
    runProperty(
      "summary-ellipsis",
      fc.property(inputs, (s) => {
        const out = normaliseSummary(s);
        const collapsed = s.replace(/[\s\u0085\u2028\u2029]+/gu, " ").trim();
        const wasCut = cpLen(collapsed) > SUMMARY_MAX_CHARS;
        if (wasCut) {
          expect(out.endsWith(ELLIPSIS)).toBe(true);
        } else {
          expect(out).toBe(collapsed);
        }
      }),
    );
  });

  it("is idempotent", () => {
    runProperty(
      "summary-idempotent",
      fc.property(inputs, (s) => {
        const once = normaliseSummary(s);
        expect(normaliseSummary(once)).toBe(once);
      }),
    );
  });

  it("never splits a surrogate pair", () => {
    runProperty(
      "summary-no-lone-surrogate",
      fc.property(fc.array(astral, { minLength: 390, maxLength: 420 }).map((a) => a.join("")), (s) => {
        const out = normaliseSummary(s);
        expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
      }),
    );
  });
});
