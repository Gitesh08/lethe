// Unit tests for load/specs.ts. Refs: Req 10.3, REQ-DEC-4
import { DEFAULT_AXES, validateOntology, type CompiledOntology } from "@lethe/core";
import { describe, expect, it } from "vitest";
import { deriveSpecs, normativeText } from "../src/load/specs.js";

const compiledResult = validateOntology(DEFAULT_AXES);
if (!compiledResult.ok) throw new Error("default ontology invalid");
const compiled: CompiledOntology = compiledResult.value;

const files = (entries: Record<string, string>): ReadonlyMap<string, string> => new Map(Object.entries(entries));
const REQS = "1. THE Tool SHALL use ESM modules only. <!-- REQ-DEC-4 -->\n\nNote REQ-AAA-1 and REQ-DEC-4 again.\n";

describe("deriveSpecs", () => {
  it("derives name, sorted unique ids, and sorts specs by name", () => {
    const specs = deriveSpecs(
      files({
        ".kiro/specs/zeta/requirements.md": REQS,
        ".kiro/specs/alpha/requirements.md": "Nothing.",
      }),
      compiled,
      undefined,
    );
    expect(specs.map((s) => s.specName)).toEqual(["alpha", "zeta"]);
    expect(specs[1]?.requirementIds).toEqual(["REQ-AAA-1", "REQ-DEC-4"]);
    expect(specs[0]?.requirementIds).toEqual([]);
  });

  it("takes stances only from SHALL paragraphs", () => {
    const text = "We use CommonJS here.\n\nThe code SHALL use ESM modules.\n";
    expect(normativeText(text)).toBe("The code SHALL use ESM modules.\n");
    const withShall = deriveSpecs(files({ ".kiro/specs/a/requirements.md": text }), compiled, undefined);
    const without = deriveSpecs(files({ ".kiro/specs/a/requirements.md": "The code uses ESM modules." }), compiled, undefined);
    expect(withShall[0]?.stances.length).toBeGreaterThan(0);
    expect(without[0]?.stances).toEqual([]);
  });

  it("derives active from tasks.md: absent active, open active, all done inactive, [-] open", () => {
    const specs = deriveSpecs(
      files({
        ".kiro/specs/a/requirements.md": "x",
        ".kiro/specs/b/tasks.md": "- [x] 1. done\n- [ ] 2. todo\n",
        ".kiro/specs/c/tasks.md": "- [x] 1. done\n  - [x] 1.1 done\n",
        ".kiro/specs/d/tasks.md": "- [x] 1. done\n- [-] 2. in progress\n",
      }),
      compiled,
      undefined,
    );
    expect(specs.map((s) => [s.specName, s.active])).toEqual([["a", true], ["b", true], ["c", false], ["d", true]]);
  });

  it("lets activeSpecs override both ways and ignores nested files", () => {
    const specs = deriveSpecs(
      files({
        ".kiro/specs/a/tasks.md": "- [x] done\n",
        ".kiro/specs/b/tasks.md": "- [ ] open\n",
        ".kiro/specs/b/sub/requirements.md": "SHALL REQ-ZZZ-9",
      }),
      compiled,
      ["a"],
    );
    expect(specs.map((s) => [s.specName, s.active])).toEqual([["a", true], ["b", false]]);
    expect(specs[1]?.requirementIds).toEqual([]);
  });
});
