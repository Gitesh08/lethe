// Unit tests for spec derivation matrix (load/specs.ts). Refs: Req 10.3, REQ-DEC-4
import { DEFAULT_AXES, validateOntology, type CompiledOntology } from "@lethe/core";
import { DEMO_SEED, generateHauntedRepo } from "@lethe/core/fixtures";
import { describe, expect, it } from "vitest";
import { deriveSpecs, hasOpenTasks, requirementIdsOf } from "../src/load/specs.js";

const compiledResult = validateOntology(DEFAULT_AXES);
if (!compiledResult.ok) throw new Error("default ontology invalid");
const compiled: CompiledOntology = compiledResult.value;

const files = (entries: Record<string, string>): ReadonlyMap<string, string> => new Map(Object.entries(entries));
const activeOf = (tasks: string | undefined, override?: readonly string[]): boolean | undefined => {
  const entries: Record<string, string> = { ".kiro/specs/s/requirements.md": "x" };
  if (tasks !== undefined) entries[".kiro/specs/s/tasks.md"] = tasks;
  return deriveSpecs(files(entries), compiled, override)[0]?.active;
};

describe("hasOpenTasks / active derivation", () => {
  it("absent tasks.md is active; all complete is inactive", () => {
    expect(activeOf(undefined)).toBe(true);
    expect(activeOf("- [x] 1. a\n  - [x] 1.1 b\n")).toBe(false);
  });

  it("counts [ ], [-] and optional '- [ ]*' as open; [~] and [x] are not open", () => {
    expect(hasOpenTasks("- [x] a\n- [-] b\n")).toBe(true);
    expect(hasOpenTasks("- [x] a\n  - [ ]* b optional\n")).toBe(true);
    expect(hasOpenTasks("- [x] a\n- [~] b\n")).toBe(false);
    expect(hasOpenTasks("- [x] a\n- [x] b\n")).toBe(false);
    expect(hasOpenTasks("")).toBe(false);
  });

  it("handles CRLF tasks.md", () => {
    expect(activeOf("- [x] a\r\n- [ ] b\r\n")).toBe(true);
    expect(activeOf("- [x] a\r\n- [x] b\r\n")).toBe(false);
  });

  it("ignores checkbox text that is not at the start of a list line", () => {
    expect(hasOpenTasks("- [x] a\ntext - [ ] not a task\n")).toBe(false);
  });
});

describe("activeSpecs override", () => {
  it("forces a complete spec active and an open spec inactive", () => {
    expect(activeOf("- [x] a\n", ["s"])).toBe(true);
    expect(activeOf("- [ ] a\n", ["other"])).toBe(false);
  });

  it("empty list makes every spec inactive, even with absent tasks.md", () => {
    expect(activeOf(undefined, [])).toBe(false);
  });

  it("ignores names that match no spec directory", () => {
    const specs = deriveSpecs(files({ ".kiro/specs/a/tasks.md": "- [ ] x\n" }), compiled, ["ghost", "a"]);
    expect(specs.map((s) => [s.specName, s.active])).toEqual([["a", true]]);
  });
});

describe("requirement ids", () => {
  it("are sorted and deduped across CRLF text", () => {
    const text = "REQ-ZZ-2 and REQ-AA-10\r\n\r\nREQ-AA-9, REQ-ZZ-2\r\n";
    expect(requirementIdsOf(text)).toEqual(["REQ-AA-10", "REQ-AA-9", "REQ-ZZ-2"]);
  });

  it("CRLF blank lines still separate SHALL paragraphs", () => {
    const text = "We use CommonJS.\r\n\r\nThe code SHALL use ESM modules.\r\n";
    const [spec] = deriveSpecs(files({ ".kiro/specs/a/requirements.md": text }), compiled, undefined);
    expect(spec?.stances).toEqual(["mod:esm"]);
  });
});

// The fixture ships SpecInvariant values (haunted-specs.ts), not spec files. Each fixture spec's
// intended stances are mapped here to SHALL sentences that the default ontology recognises.
const FIXTURE_REQUIREMENTS: Record<string, string> = {
  "lethe-core":
    "THE engine SHALL use ESM modules. REQ-DEC-1\n\nTHE engine SHALL return Result types. REQ-DEC-4\n\nTHE code SHALL use strict TypeScript. REQ-CON-3\n",
  "lethe-mcp": "THE server SHALL use ESM modules. REQ-MCP-1\n",
  "lethe-web-sandbox": "THE UI SHALL use signals. REQ-SBX-1\n\nTHE UI SHALL use pure CSS. REQ-SBX-2\n",
};

describe("haunted fixture specs", () => {
  const repo = generateHauntedRepo(DEMO_SEED);
  const entries: Record<string, string> = {};
  for (const name of Object.keys(FIXTURE_REQUIREMENTS)) {
    entries[`.kiro/specs/${name}/requirements.md`] = FIXTURE_REQUIREMENTS[name] ?? "";
    entries[`.kiro/specs/${name}/tasks.md`] = "- [x] 1. done\n- [ ] 2. open\n";
  }
  const derived = deriveSpecs(files(entries), compiled, undefined);

  it("yields the fixture's spec names, all active", () => {
    expect(derived.map((s) => s.specName)).toEqual([...repo.specs.map((s) => s.specName)].sort());
    expect(derived.every((s) => s.active)).toBe(true);
  });

  it("yields the stances the fixture intends each spec to assert", () => {
    for (const intended of repo.specs) {
      const got = derived.find((s) => s.specName === intended.specName);
      expect([...(got?.stances ?? [])].sort()).toEqual([...intended.stances].sort());
    }
  });
});
