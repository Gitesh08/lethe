// Decay property tests: P1 range, P2 monotonic, P3 reinforcement, P4 protected (decay half),
// P9 determinism, P10 one tier per engram (both included below, task 8.5).
// P4's archive half is wired in task 15.2 by passing the planArchivedIds callback.
// Refs: REQ-DEC-1, REQ-DEC-2, REQ-DEC-3, REQ-DEC-4, REQ-DEC-7, REQ-PBT-1, REQ-PBT-4

import { describe, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { P1_ID, p1Range } from "../src/properties/p1-range.js";
import { P2_ID, p2Monotonic } from "../src/properties/p2-monotonic.js";
import { P3_ID, p3Reinforce } from "../src/properties/p3-reinforce.js";
import { P4_ID, p4Protected } from "../src/properties/p4-protected.js";
import { P9_ID, p9Determinism } from "../src/properties/p9-determinism.js";
import { P10_ID, p10Partition } from "../src/properties/p10-partition.js";
import type { LetheConfig } from "../src/types.js";
import { runProperty } from "./pbt-runner.js";

/** Spec-heavy weighting, steeper stability growth and a fast day->commit rate. */
const ALT_CFG: LetheConfig = { ...DEFAULT_CONFIG, wSpec: 8, beta: 1, alpha: 1 };

describe("P1 0 < R <= 1", () => {
  it("holds for DEFAULT_CONFIG", () => {
    runProperty(P1_ID, p1Range(DEFAULT_CONFIG));
  });

  it("holds for a spec-heavy, non-default config", () => {
    runProperty(`${P1_ID}/alt`, p1Range(ALT_CFG));
  });
});

describe("P2 retention is monotonic without reinforcement", () => {
  it("holds for DEFAULT_CONFIG", () => {
    runProperty(P2_ID, p2Monotonic(DEFAULT_CONFIG));
  });

  it("holds for a spec-heavy, non-default config", () => {
    runProperty(`${P2_ID}/alt`, p2Monotonic(ALT_CFG));
  });
});

describe("P3 reinforcement never lowers S or R", () => {
  it("holds for DEFAULT_CONFIG", () => {
    runProperty(P3_ID, p3Reinforce(DEFAULT_CONFIG));
  });

  it("holds for a spec-heavy, non-default config", () => {
    runProperty(`${P3_ID}/alt`, p3Reinforce(ALT_CFG));
  });
});

describe("P4 protected engrams keep R >= specFloor (decay half)", () => {
  it("holds for DEFAULT_CONFIG", () => {
    runProperty(P4_ID, p4Protected(DEFAULT_CONFIG));
  });
});

describe("P9 same inputs give byte-identical outputs", () => {
  it("holds for DEFAULT_CONFIG", () => {
    runProperty(P9_ID, p9Determinism(DEFAULT_CONFIG));
  });

  it("holds for a spec-heavy, non-default config", () => {
    runProperty(`${P9_ID}/alt`, p9Determinism(ALT_CFG));
  });
});

describe("P10 every engram is in exactly one tier", () => {
  it("holds for DEFAULT_CONFIG", () => {
    runProperty(P10_ID, p10Partition(DEFAULT_CONFIG));
  });

  it("holds for a spec-heavy, non-default config", () => {
    runProperty(`${P10_ID}/alt`, p10Partition(ALT_CFG));
  });
});
