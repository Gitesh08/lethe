// Contradiction property tests: P11 symmetric/canonical detection, P5 no coexisting contradictions.
// P5 runs the defect half and the end-to-end half (real pipeline, re-score + re-detect).
// Refs: REQ-CON-2, REQ-CON-3, REQ-CON-4, REQ-CON-6, REQ-PBT-1, REQ-PBT-4, INV-5

import { describe, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { P5_ID, p5Contradiction } from "../src/properties/p5-contradiction.js";
import { P11_ID, p11Symmetric } from "../src/properties/p11-symmetric.js";
import type { LetheConfig } from "../src/types.js";
import { runProperty } from "./pbt-runner.js";

/** Shifted tier thresholds: nearly everything Warm/Hot boundary moves. */
const ALT_CFG: LetheConfig = { ...DEFAULT_CONFIG, hotMin: 0.9, cryptMax: 0.1 };

describe("P11 detection is symmetric and canonical", () => {
  it("holds for DEFAULT_CONFIG", () => {
    runProperty(P11_ID, p11Symmetric(DEFAULT_CONFIG));
  });

  it("holds for shifted tier thresholds", () => {
    runProperty(`${P11_ID}/alt`, p11Symmetric(ALT_CFG));
  });
});

describe("P5 no contradicting pair coexists (defect + end-to-end)", () => {
  it("holds for DEFAULT_CONFIG", () => {
    runProperty(P5_ID, p5Contradiction(DEFAULT_CONFIG));
  });

  it("holds for shifted tier thresholds", () => {
    runProperty(`${P5_ID}/alt`, p5Contradiction(ALT_CFG));
  });
});
