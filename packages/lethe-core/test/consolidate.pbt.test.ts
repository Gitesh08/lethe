// Consolidation property tests: P4 (decay + end-to-end), P6 budget, P8 idempotence.
// Refs: REQ-PBT-1, REQ-CRY-1, REQ-CRY-2, INV-1, INV-4, INV-6

import { describe, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { P4_ID, p4Protected, p4ProtectedEndToEnd } from "../src/properties/p4-protected.js";
import { P6_ID, p6Budget } from "../src/properties/p6-budget.js";
import { P8_ID, p8Idempotent, p8IdempotentDuplicates } from "../src/properties/p8-idempotent.js";
import type { LetheConfig } from "../src/types.js";
import { runProperty } from "./pbt-runner.js";

const SHIFTED_CFG: LetheConfig = { ...DEFAULT_CONFIG, hotMin: 0.9, cryptMax: 0.1 };
const TIGHT_CFG: LetheConfig = { ...DEFAULT_CONFIG, budgetTokens: 60 };

describe("P4 protected engrams are never archived", () => {
  it("holds for DEFAULT_CONFIG (decay + end-to-end)", () => {
    runProperty(P4_ID, p4Protected(DEFAULT_CONFIG));
  });

  it("holds end-to-end under a tight 60-token budget", () => {
    runProperty(`${P4_ID}/e2e-tight`, p4ProtectedEndToEnd(TIGHT_CFG));
  });
});

describe("P6 Hot tokens fit the budget or budget_infeasible is reported", () => {
  it("holds for DEFAULT_CONFIG", () => {
    runProperty(P6_ID, p6Budget(DEFAULT_CONFIG));
  });

  it("holds for shifted tier thresholds", () => {
    runProperty(`${P6_ID}/alt`, p6Budget(SHIFTED_CFG));
  });
});

describe("P8 consolidation is idempotent", () => {
  it("holds for DEFAULT_CONFIG", () => {
    runProperty(P8_ID, p8Idempotent(DEFAULT_CONFIG));
  });

  it("holds for duplicate-heavy workspaces", () => {
    runProperty(`${P8_ID}/duplicates`, p8IdempotentDuplicates(DEFAULT_CONFIG));
  });
});
