// Unit + property tests for deriveSpecStances / chunkSpecText.
// Refs: Req 10.3 (lethe-mcp), REQ-CON-1, REQ-CON-2
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_AXES } from "../src/contradiction/default-ontology.js";
import {
  SPEC_CHUNK_CHARS,
  chunkSpecText,
  deriveSpecStances,
} from "../src/contradiction/spec-stances.js";
import { validateOntology } from "../src/contradiction/validate-ontology.js";
import { hauntedSpecs } from "../src/fixtures/haunted-specs.js";
import { runProperty } from "./pbt-runner.js";

const compiledResult = validateOntology(DEFAULT_AXES);
if (!compiledResult.ok) throw new Error("default ontology must compile");
const compiled = compiledResult.value;
const ALL_IDS: ReadonlySet<string> = new Set(DEFAULT_AXES.flatMap((a) => a.stances.map((s) => s.id)));

/** Normative wording per stance id, as a spec's SHALL paragraph would assert it. */
const NORMATIVE: Readonly<Record<string, string>> = {
  "mod:esm": "The package SHALL use ESM modules.",
  "err:result-types": "Failures SHALL be returned as Result types.",
  "typing:strict-ts": "The code SHALL compile under strict TypeScript.",
  "state:signals": "Component state SHALL be held in signals.",
  "css:pure-css": "Styles SHALL be written in pure CSS.",
};

const sorted = (xs: readonly string[]): string[] => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

describe("deriveSpecStances: haunted specs", () => {
  for (const spec of hauntedSpecs()) {
    it(`yields the declared stances for ${spec.specName}`, () => {
      const text = spec.stances.map((id) => NORMATIVE[id] ?? "").join("\n\n");
      expect(spec.stances.every((id) => NORMATIVE[id] !== undefined)).toBe(true);
      expect(deriveSpecStances(text, compiled)).toEqual(sorted(spec.stances));
    });
  }
});

describe("deriveSpecStances: polarity and sizes", () => {
  it("ignores negated mentions", () => {
    expect(deriveSpecStances("Do not use Tailwind.", compiled)).toEqual([]);
    expect(deriveSpecStances("Never use Redux. Avoid CommonJS.", compiled)).toEqual([]);
  });

  it("finds a stance mentioned only after char 30,000 of a ~40 KB text", () => {
    const noise = "The quick brown fox jumps over the lazy dog today.\n\n";
    const prefix = noise.repeat(Math.ceil(30_500 / noise.length));
    const text = prefix + NORMATIVE["mod:esm"] + "\n\n" + noise.repeat(180);
    expect(text.length).toBeGreaterThan(38_000);
    expect(text.indexOf("ESM")).toBeGreaterThan(30_000);
    expect(deriveSpecStances(text, compiled)).toEqual(["mod:esm"]);
  });

  it("handles one paragraph > 8,000 chars made of sentences", () => {
    const sentences = Array.from({ length: 400 }, (_, i) => `Filler line number ${i} is calm.`);
    sentences.splice(200, 0, NORMATIVE["css:pure-css"] ?? "");
    const para = sentences.join(" ");
    expect(para.length).toBeGreaterThan(8000);
    expect(deriveSpecStances(para, compiled)).toEqual(["css:pure-css"]);
  });

  it("handles one sentence > 8,000 chars (hard split)", () => {
    // Limitation: a hard split every SPEC_CHUNK_CHARS chars can cut a stance phrase in
    // two (e.g. "ES" | "M"), losing it. This case puts the phrase well inside a piece.
    const filler = "calm ".repeat(1000);
    const sentence = `${filler}we adopt ESM modules ${filler}`;
    expect(sentence.length).toBeGreaterThan(8000);
    expect(deriveSpecStances(sentence, compiled)).toEqual(["mod:esm"]);
  });

  it("gives identical results for CRLF and LF", () => {
    const lf = [NORMATIVE["mod:esm"], "Do not use Tailwind.", NORMATIVE["state:signals"]].join("\n\n");
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(deriveSpecStances(crlf, compiled)).toEqual(deriveSpecStances(lf, compiled));
    expect(deriveSpecStances(lf, compiled)).toEqual(["mod:esm", "state:signals"]);
  });

  it("returns [] for empty or whitespace-only text", () => {
    expect(deriveSpecStances("", compiled)).toEqual([]);
    expect(deriveSpecStances(" \r\n\t \n\n  ", compiled)).toEqual([]);
  });
});

describe("chunkSpecText", () => {
  it("never exceeds SPEC_CHUNK_CHARS and loses no characters (short sentences, no terminators)", () => {
    const words = Array.from({ length: 6000 }, (_, i) => `w${i}`);
    const para = words.join(" ");
    const text = `${para}\n\nsecond para\r\n\r\n${para}`;
    const chunks = chunkSpecText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= SPEC_CHUNK_CHARS)).toBe(true);
    expect(chunks.join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
  });

  it("loses no characters across paragraph packing and sentence packing (apart from sentence terminators)", () => {
    // Finding: splitSentences drops the terminating '.', '!' or '?' of each sentence, so
    // oversized paragraphs lose those characters (harmless for stance matching).
    const para = Array.from({ length: 900 }, (_, i) => `Sentence ${i} here.`).join(" ");
    const chunks = chunkSpecText(`${para}\n\nTail text.`);
    expect(chunks.every((c) => c.length <= SPEC_CHUNK_CHARS)).toBe(true);
    const strip = (s: string): string => s.replace(/[\s.!?]/g, "");
    expect(strip(chunks.join(""))).toBe(strip(`${para}\n\nTail text.`));
  });

  it("splits a single 20,000-char token run into bounded pieces", () => {
    const chunks = chunkSpecText("x".repeat(20_000));
    expect(chunks.every((c) => c.length <= SPEC_CHUNK_CHARS)).toBe(true);
    expect(chunks.join("")).toBe("x".repeat(20_000));
  });
});

const STANCE_SENTENCES: readonly string[] = [
  ...Object.values(NORMATIVE),
  "Do not use Tailwind.",
  "Never use Redux.",
  "Avoid CommonJS modules.",
  "Use Zustand for state.",
  "We prefer Vitest.",
];
const NOISE_SENTENCES: readonly string[] = [
  "The quick brown fox jumps over the lazy dog.",
  "Meetings happen on Tuesday.",
  "Keep functions small and readable!",
  "Is this clear?",
  "- bullet about nothing in particular",
];

const paragraphArb = fc
  .array(fc.constantFrom(...STANCE_SENTENCES, ...NOISE_SENTENCES), { minLength: 1, maxLength: 5 })
  .map((s) => s.join(" "));

describe("deriveSpecStances: properties", () => {
  it("result is sorted, unique, a subset of ontology ids, and paragraph-permutation invariant", () => {
    runProperty(
      "spec-stances",
      fc.property(
        fc.array(fc.tuple(paragraphArb, fc.nat()), { minLength: 0, maxLength: 12 }),
        fc.boolean(),
        (items, crlf) => {
          const sep = crlf ? "\r\n\r\n" : "\n\n";
          const original = items.map(([p]) => p);
          const permuted = items
            .map(([p, k], i) => ({ p, k, i }))
            .sort((a, b) => b.k - a.k || a.i - b.i)
            .map((x) => x.p);
          const result = deriveSpecStances(original.join(sep), compiled);
          expect(result).toEqual(sorted(result));
          expect(new Set(result).size).toBe(result.length);
          expect(result.every((id) => ALL_IDS.has(id))).toBe(true);
          expect(deriveSpecStances(permuted.join(sep), compiled)).toEqual(result);
        },
      ),
    );
  });
});
