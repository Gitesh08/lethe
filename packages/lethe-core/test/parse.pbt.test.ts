// P12 property tests: serialize(parse(text)) === text.
// Refs: REQ-PAR-1, REQ-PAR-6, REQ-PBT-1, REQ-PBT-4

import fc from "fast-check";
import { describe, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { parseDocument, serializeDocument } from "../src/parse/document.js";
import { P12_ID, p12Serialize } from "../src/properties/p12-serialize.js";
import type { LetheConfig } from "../src/types.js";
import { adversarialMarkdownArb } from "../src/properties/arbitraries/engram.arb.js";
import { runProperty } from "./pbt-runner.js";

const SECTION_CFG: LetheConfig = { ...DEFAULT_CONFIG, granularity: "section" };
const BULLET_CFG: LetheConfig = { ...DEFAULT_CONFIG, granularity: "bullet" };

/** Adversarial pass: round-trip on every successful parse; only documented errors allowed. */
function adversarialRoundTrip(cfg: LetheConfig) {
  return fc.property(adversarialMarkdownArb, (d) => {
    const r = parseDocument("steering/p12.md", d, cfg);
    if (!r.ok) {
      if (r.error.code !== "PARSE_INVALID_FRONTMATTER" && r.error.code !== "PARSE_DUPLICATE_ID") {
        throw new Error(`unexpected parse error ${r.error.code}: ${r.error.message}`);
      }
      return;
    }
    if (serializeDocument(r.value) !== d) throw new Error("serializeDocument(parse(d)) !== d");
  });
}

describe("P12 serialize(parse(text)) === text", () => {
  it("holds for granularity 'section'", () => {
    runProperty(`${P12_ID}/section`, p12Serialize(SECTION_CFG));
  });

  it("holds for granularity 'bullet'", () => {
    runProperty(`${P12_ID}/bullet`, p12Serialize(BULLET_CFG));
  });

  it("holds on adversarial documents (section)", () => {
    runProperty(`${P12_ID}/adversarial/section`, adversarialRoundTrip(SECTION_CFG));
  });

  it("holds on adversarial documents (bullet)", () => {
    runProperty(`${P12_ID}/adversarial/bullet`, adversarialRoundTrip(BULLET_CFG));
  });
});
