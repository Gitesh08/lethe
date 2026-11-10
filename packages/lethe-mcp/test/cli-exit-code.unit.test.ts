import { describe, expect, it } from "vitest";
import { CLI_COMMAND_NAMES } from "../src/cli/command-name.js";
import { ERROR_EXIT, exitCodeFor } from "../src/cli/exit-code.js";
import { fail, ok } from "../src/envelope/envelope.js";
import { TOOL_ERROR_CODES, toolError } from "../src/envelope/errors.js";

const checkData = (count: number, unresolvable: number) => ok("s", { reports: [], count, unresolvable, diagnostics: [] });

describe("exitCodeFor", () => {
  const expected: Record<string, number> = {
    PARSE_INVALID_FRONTMATTER: 74, PARSE_DUPLICATE_ID: 74, CONFIG_INVALID: 74, ONTOLOGY_INVALID_PATTERN: 74,
    BUDGET_INFEASIBLE: 74, TOMBSTONE_NOT_FOUND: 1, PATH_ESCAPE: 74, PBT_GATE_FAILED: 1,
    INVALID_INPUT: 74, LOCKED: 74, IO_FAILED: 74, INTERNAL_ERROR: 70,
  };

  it.each(TOOL_ERROR_CODES)("maps %s", (code) => {
    expect(ERROR_EXIT[code]).toBe(expected[code]);
    const env = fail(toolError(code, "m"));
    expect(exitCodeFor("score", env, {})).toBe(expected[code]);
    expect(exitCodeFor("score", env, { block: true })).toBe(expected[code] === 1 ? 2 : expected[code]);
  });

  it("returns 0 for plain success on every command", () => {
    for (const c of CLI_COMMAND_NAMES.filter((n) => n !== "check")) expect(exitCodeFor(c, ok("s", {}), {})).toBe(0);
  });

  it("check honours --fail-on and --block", () => {
    expect(exitCodeFor("check", checkData(0, 0), {})).toBe(0);
    expect(exitCodeFor("check", checkData(2, 0), {})).toBe(1);
    expect(exitCodeFor("check", checkData(2, 0), { failOn: "any", block: true })).toBe(2);
    expect(exitCodeFor("check", checkData(2, 0), { failOn: "unresolvable" })).toBe(0);
    expect(exitCodeFor("check", checkData(2, 1), { failOn: "unresolvable" })).toBe(1);
    expect(exitCodeFor("check", checkData(2, 1), { failOn: "never", block: true })).toBe(0);
  });

  it("sleep gate failure exits 1 (2 with --block)", () => {
    const env = ok("s", { pbtGate: "failed" });
    expect(exitCodeFor("sleep", env, {})).toBe(1);
    expect(exitCodeFor("sleep", env, { block: true })).toBe(2);
    expect(exitCodeFor("sleep", ok("s", { pbtGate: "skipped" }), {})).toBe(0);
  });

  it("resurrect with no match exits 1", () => {
    expect(exitCodeFor("resurrect", fail(toolError("TOMBSTONE_NOT_FOUND", "x")), {})).toBe(1);
  });

  it("usage errors exit 64", () => {
    expect(exitCodeFor("check", { kind: "usage", message: "bad", hint: "h" }, { block: true })).toBe(64);
  });
});
