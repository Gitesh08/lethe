// Crypt property tests: P7 resurrect(archive(e)) deep-equals e (task 15.7).
// Refs: REQ-CRY-3, REQ-PBT-1, REQ-PBT-4, INV-3
//
// KNOWN LIMITATION (bullet granularity): engram ids are positional, so burying a
// non-last bullet renumbers its successors and the buried id collides. resurrect
// then returns PARSE_DUPLICATE_ID and leaves the workspace untouched. Only the
// last bullet of a file round-trips byte-exact; the property asserts exactly that.
//
// Note: other agents run in parallel in this package. This file must not touch
// test/consolidate.pbt.test.ts or src/properties/p5-*.

import { describe, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { P7_ID, p7Roundtrip } from "../src/properties/p7-roundtrip.js";
import { runProperty } from "./pbt-runner.js";

describe("P7 resurrect(archive(e)) deep-equals e", () => {
  it("holds for DEFAULT_CONFIG (section granularity)", () => {
    runProperty(P7_ID, p7Roundtrip(DEFAULT_CONFIG));
  });

  it("holds at bullet granularity (only the last bullet round-trips; others give PARSE_DUPLICATE_ID untouched)", () => {
    runProperty(`${P7_ID}/bullet`, p7Roundtrip({ ...DEFAULT_CONFIG, granularity: "bullet" }));
  });

  it("holds when more engrams are buried (cryptMax 0.5, hotMin 0.9)", () => {
    runProperty(`${P7_ID}/bury-more`, p7Roundtrip({ ...DEFAULT_CONFIG, cryptMax: 0.5, hotMin: 0.9 }));
  });
});
