// Refs: Req 1.1, Req 1.7, REQ-MCP-1
import { describe, expect, it } from "vitest";
import { TOOLS, TOOL_NAMES, findTool } from "../src/tools/registry.js";

describe("tool registry", () => {
  it("exposes exactly four tools in fixed order", () => {
    expect(TOOLS).toHaveLength(4);
    expect(TOOL_NAMES).toEqual([
      "lethe_score_memories",
      "lethe_detect_contradictions",
      "lethe_consolidate_sleep",
      "lethe_resurrect_engram",
    ]);
  });

  it("finds tools by exact name only", () => {
    for (const t of TOOLS) expect(findTool(t.name)).toBe(t);
    for (const bad of ["__proto__", "constructor", "toString", "", "LETHE_SCORE_MEMORIES", " lethe_score_memories"]) {
      expect(findTool(bad)).toBeUndefined();
    }
  });

  it("publishes strict object JSON schemas", () => {
    for (const t of TOOLS) {
      expect(t.jsonSchema["type"]).toBe("object");
      expect(t.jsonSchema["additionalProperties"]).toBe(false);
    }
  });
});
