import { describe, it, expect } from "vitest";
import { LETHE_CORE_VERSION } from "../src/index.js";

describe("lethe-core smoke", () => {
  it("exports version", () => {
    expect(LETHE_CORE_VERSION).toBe("0.1.0");
  });
});
