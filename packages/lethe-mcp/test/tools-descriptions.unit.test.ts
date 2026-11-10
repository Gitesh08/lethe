// Registry-driven checks of the four tool descriptions. Refs: Req 1.4, 2.6, Rules-12, REQ-MCP-2, REQ-MCP-3
import { describe, expect, it } from "vitest";
import { TOOLS } from "../src/tools/registry.js";

const byName = (name: string): string => {
  const t = TOOLS.find((x) => x.name === name);
  if (t === undefined) throw new Error(`missing tool ${name}`);
  return t.description;
};

describe("tool descriptions", () => {
  for (const tool of TOOLS) {
    describe(tool.name, () => {
      const d = tool.description;
      it("says when to call it and what it returns", () => {
        expect(d).toContain("Call this");
        expect(d).toMatch(/\breturns\b/i);
      });
      it("is at most 1,200 characters", () => {
        expect(d.length).toBeLessThanOrEqual(1200);
      });
      if (tool.mutating) {
        it("states the dry-run default and that apply: true is needed", () => {
          expect(d).toContain("dry-run");
          expect(d).toContain("apply: true");
          expect(d).toMatch(/Pass apply: true to change files/);
          expect(d).toMatch(/writes nothing/);
        });
      } else {
        it("says it is read-only and safe", () => {
          expect(d).toContain("Read-only");
          expect(d).toContain("safe");
        });
      }
    });
  }

  it("covers exactly two mutating and two read-only tools", () => {
    expect(TOOLS.filter((t) => t.mutating)).toHaveLength(2);
    expect(TOOLS.filter((t) => !t.mutating)).toHaveLength(2);
  });

  it("sleep forbids skipGate combined with apply", () => {
    expect(byName("lethe_consolidate_sleep")).toContain("Never combine skipGate with apply");
  });

  it("score labels reinforcement figures as estimated utility, with no usefulness claim", () => {
    const d = byName("lethe_score_memories");
    expect(d).toContain("estimated utility");
    // The only allowed mention of "useful" is the explicit negation.
    const stripped = d.replace("not proof that a rule is useful", "");
    expect(stripped).not.toMatch(/\b(useful|helpful)\b/i);
  });
});
