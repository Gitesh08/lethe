import { describe, expect, it } from "vitest";
import { LETHE_CORE_VERSION } from "@lethe/core";
import * as fixtures from "@lethe/core/fixtures";
import * as properties from "@lethe/core/properties";
import { LETHE_MCP_VERSION } from "../src/index.js";

describe("workspace link smoke test", () => {
  it("resolves @lethe/core and the package index", () => {
    expect(LETHE_CORE_VERSION).toBe("0.1.0");
    expect(LETHE_MCP_VERSION).toBe("0.1.0");
  });

  it("resolves the @lethe/core subpath exports", () => {
    expect(typeof fixtures.generateHauntedRepo).toBe("function");
    expect(typeof properties.runGate).toBe("function");
  });
});
