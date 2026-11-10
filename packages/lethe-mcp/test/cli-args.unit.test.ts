// Unit tests for cli/args.ts. Refs: Req 13.1, 13.2, 13.4, 11.3, 12.4
import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli/args.js";

const run = (...argv: string[]) => {
  const r = parseArgs(argv);
  if (!r.ok) throw new Error(`usage error: ${r.error.message}`);
  return r.value;
};
const fail = (...argv: string[]) => {
  const r = parseArgs(argv);
  if (r.ok) throw new Error("expected usage error");
  return r.error;
};

describe("parseArgs happy paths", () => {
  it("check defaults", () => {
    expect(run("check")).toEqual({
      kind: "run", global: { workspace: ".", json: false },
      args: { command: "check", scope: "steering-vs-specs", failOn: "any", block: false },
    });
  });

  it("check with all options and global options before and after the subcommand", () => {
    const v = run("--json", "check", "--workspace", "/w", "--scope=all", "--fail-on", "never", "--block", "--commit=7");
    expect(v).toEqual({
      kind: "run", global: { workspace: "/w", json: true, commit: 7 },
      args: { command: "check", scope: "all", failOn: "never", block: true },
    });
  });

  it("record splits comma lists and accepts both value forms", () => {
    const v = run("record", "--type", "spec_cited", "--cited=a, b", "--files", "x.ts,y.ts", "--files-from-git");
    expect(v).toMatchObject({ args: { command: "record", type: "spec_cited", files: ["x.ts", "y.ts"], cited: ["a", "b"], filesFromGit: true } });
  });

  it("task_passed needs neither files nor cited", () => {
    expect(run("record", "--type", "task_passed")).toMatchObject({ args: { files: [], cited: [], filesFromGit: false } });
  });

  it("score, sleep, resurrect, adopt, probe, serve", () => {
    expect(run("score", "--include-specs")).toMatchObject({ args: { command: "score", includeSpecs: true } });
    expect(run("sleep")).toMatchObject({ args: { command: "sleep", apply: false, skipGate: false, gateRuns: 100 } });
    const s = run("sleep", "--apply", "--budget", "500", "--gate-runs=1000", "--now", "2026-11-20T10:00:00Z");
    expect(s).toMatchObject({ global: { now: "2026-11-20T10:00:00Z" }, args: { apply: true, budget: 500, gateRuns: 1000 } });
    expect(run("sleep", "--skip-gate")).toMatchObject({ args: { skipGate: true, apply: false } });
    expect(run("resurrect", "--query", "css rule", "--apply")).toMatchObject({ args: { query: "css rule", apply: true } });
    expect(run("adopt", "--apply")).toMatchObject({ args: { command: "adopt", apply: true } });
    expect(run("probe").kind).toBe("run");
    expect(run("serve")).toMatchObject({ args: { command: "serve" } });
  });

  it("--help and --version win anywhere, even beside errors", () => {
    expect(run("--help")).toEqual({ kind: "help" });
    expect(run("sleep", "--bogus", "-h")).toEqual({ kind: "help", command: "sleep" });
    expect(run("check", "--version", "--bogus")).toEqual({ kind: "version" });
  });
});

describe("parseArgs usage errors", () => {
  it.each([
    [[], "missing subcommand"],
    [["frobnicate"], "unknown subcommand"],
    [["check", "--bogus"], "unknown option"],
    [["check", "-x"], "unknown option"],
    [["check", "--apply"], "unknown option"],
    [["--scope", "all", "check"], "unknown option"],
    [["check", "extra"], "unexpected argument"],
    [["check", "--scope"], "requires a value"],
    [["check", "--scope", "--block"], "requires a value"],
    [["check", "--scope=bad"], "invalid value"],
    [["check", "--fail-on", "sometimes"], "invalid value"],
    [["check", "--block=yes"], "does not take a value"],
    [["check", "--block", "--block"], "duplicate"],
    [["score", "--commit", "-1"], "requires a value|invalid value"],
    [["score", "--commit", "1.5"], "invalid value"],
    [["score", "--commit", "abc"], "invalid value"],
    [["score", "--now", "yesterday"], "invalid value"],
    [["score", "--now", "2026-02-30T00:00:00Z"], "invalid value"],
    [["sleep", "--budget", "0"], "invalid value"],
    [["sleep", "--gate-runs", "0"], "invalid value"],
    [["sleep", "--gate-runs", "10001"], "invalid value"],
    [["record"], "requires --type"],
    [["record", "--type", "nope"], "invalid value"],
    [["record", "--type", "spec_cited"], "requires a non-empty --cited"],
    [["record", "--type", "manual_pin", "--cited="], "requires a non-empty --cited"],
    [["resurrect"], "requires --query"],
    [["sleep", "--skip-gate", "--apply"], "--skip-gate cannot be combined"],
  ])("rejects %j", (argv, pattern) => {
    const e = fail(...argv);
    expect(e.message).toMatch(new RegExp(pattern));
    expect(e.hint.length).toBeGreaterThan(0);
    expect(e.hint).not.toContain("\n");
  });
});

describe("--block on sleep and resurrect (Req 13.3)", () => {
  it("is accepted and carried", () => {
    expect(run("sleep", "--block")).toMatchObject({ args: { command: "sleep", block: true } });
    expect(run("resurrect", "--query", "q", "--block")).toMatchObject({ args: { command: "resurrect", block: true } });
  });
});
