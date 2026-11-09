import { describe, it, expect } from "vitest";
import { DEFAULT_AXES } from "../src/contradiction/default-ontology.js";
import { validateOntology } from "../src/contradiction/validate-ontology.js";
import { MAX_SCAN_CHARS, scanEngram, splitSentences, negationInWindow } from "../src/contradiction/scan.js";

const res = validateOntology(DEFAULT_AXES);
if (!res.ok) throw new Error("default ontology invalid");
const compiled = res.value;

const pol = (body: string, stanceId: string): string | undefined =>
  scanEngram(body, compiled).find((m) => m.stanceId === stanceId)?.polarity;

describe("scanEngram (REQ-CON-2)", () => {
  it("detects PRD demo sentences", () => {
    expect(pol("Use RxJS BehaviorSubject for state.", "state:rxjs-subjects")).toBe("+");
    expect(pol("Use signals for state.", "state:signals")).toBe("+");
    expect(pol("Do not use Tailwind.", "css:tailwind")).toBe("-");
    expect(pol("Use Tailwind.", "css:tailwind")).toBe("+");
    expect(pol("Never use RxJS subjects", "state:rxjs-subjects")).toBe("-");
  });

  it("handles 'no Tailwind' next to a positive pure-css stance", () => {
    const body = "Use pure CSS, no Tailwind";
    expect(pol(body, "css:tailwind")).toBe("-");
    expect(pol(body, "css:pure-css")).toBe("+");
  });

  it("negation window is exactly 4 tokens", () => {
    expect(negationInWindow("never a b c ")).toBe(true);
    expect(negationInWindow("never a b c d ")).toBe(false);
    expect(pol("avoid one two three Tailwind", "css:tailwind")).toBe("-");
    expect(pol("avoid one two three four Tailwind", "css:tailwind")).toBe("+");
  });

  it("matches negation as whole tokens only", () => {
    expect(negationInWindow("I know ")).toBe(false);
    expect(negationInWindow("node ")).toBe(false);
    expect(negationInWindow("no ")).toBe(true);
  });

  it("supports 'instead of' and contractions", () => {
    expect(negationInWindow("instead of ")).toBe(true);
    expect(negationInWindow("instead ")).toBe(false);
    expect(negationInWindow("we don't ")).toBe(true);
    expect(negationInWindow("it cannot ")).toBe(true);
    expect(negationInWindow("without ")).toBe(true);
  });

  it("returns matches per sentence in order", () => {
    const out = scanEngram("Use Tailwind.\nUse signals for state! Do not use Redux Toolkit?", compiled);
    const ids = out.map((m) => `${m.stanceId}${m.polarity}`);
    expect(ids).toEqual(["css:tailwind+", "state:signals+", "state:redux-"]);
    expect(out[0]?.evidence).toBe("Use Tailwind");
  });

  it("strips markdown noise from evidence", () => {
    const out = scanEngram("- Use Tailwind.\n1. Use signals for state.\n## Use Vitest", compiled);
    expect(out.map((m) => m.evidence)).toEqual(["Use Tailwind", "Use signals for state", "Use Vitest"]);
  });

  it("does not split inside tokens", () => {
    expect(splitSentences("See page.module.css and Node.js 3.5 src/a.ts now.")).toEqual([
      "See page.module.css and Node.js 3.5 src/a.ts now",
    ]);
    expect(splitSentences("Use it, e.g. Redux. Then stop")).toEqual(["Use it, e.g. Redux", "Then stop"]);
  });

  it("truncates at MAX_SCAN_CHARS", () => {
    const pad = "a".repeat(MAX_SCAN_CHARS);
    expect(scanEngram(`${pad} Use Tailwind.`, compiled)).toEqual([]);
    expect(scanEngram(`Use Tailwind. ${pad}`, compiled).length).toBe(1);
  });

  it("returns [] for empty body", () => {
    expect(scanEngram("", compiled)).toEqual([]);
    expect(scanEngram("  \n . ", compiled)).toEqual([]);
  });

  it("is deterministic and does not mutate frozen inputs", () => {
    const body = Object.freeze("Use Tailwind. Do not use Redux Toolkit.");
    const frozen = Object.freeze(compiled.map((a) => Object.freeze(a)));
    expect(scanEngram(body, frozen)).toEqual(scanEngram(body, frozen));
  });
});
