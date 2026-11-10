// Table-driven unit tests for cli/args.ts: accepted forms per subcommand, usage-error classes, bounds, defaults.
// Complements cli-args.unit.test.ts. Exit-code (64) mapping is covered by the runner tests (10.6).
// Refs: Req 13.1, 13.4, 13.5
import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli/args.js";

const NOW = "2026-11-20T10:00:00Z";
const DEFAULT_GLOBAL = { workspace: ".", json: false };

const runOf = (argv: ReadonlyArray<string>) => {
  const r = parseArgs(argv);
  if (!r.ok) throw new Error(`unexpected usage error: ${r.error.message}`);
  return r.value;
};

describe("minimal valid argv per subcommand (defaults)", () => {
  it.each([
    [["check"], { command: "check", scope: "steering-vs-specs", failOn: "any", block: false }],
    [["record", "--type", "task_passed"], { command: "record", type: "task_passed", files: [], filesFromGit: false, cited: [] }],
    [["score"], { command: "score", includeSpecs: false }],
    [["sleep"], { command: "sleep", apply: false, skipGate: false, gateRuns: 100, block: false }],
    [["resurrect", "--query", "q"], { command: "resurrect", query: "q", apply: false, block: false }],
    [["adopt"], { command: "adopt", apply: false }],
    [["probe"], { command: "probe" }],
    [["serve"], { command: "serve" }],
  ])("%j", (argv, args) => {
    // Req 13.5 note: the parser returns workspace "." as-is; resolving it to the cwd is the runner's job.
    expect(runOf(argv)).toStrictEqual({ kind: "run", global: DEFAULT_GLOBAL, args });
  });
});

describe("maximal valid argv per subcommand (mixed value forms, globals before and after)", () => {
  const g = { workspace: "/w", json: true, now: NOW, commit: 5 };
  it.each([
    [
      ["--json", "check", "--workspace", "/w", "--scope=all", "--fail-on", "unresolvable", "--block", `--now=${NOW}`, "--commit", "5"],
      { command: "check", scope: "all", failOn: "unresolvable", block: true },
    ],
    [
      ["record", "--type=spec_cited", "--files", "a.ts,b.ts", "--files-from-git", "--cited=x,y", "--json", "--workspace=/w", "--now", NOW, "--commit=5"],
      { command: "record", type: "spec_cited", files: ["a.ts", "b.ts"], filesFromGit: true, cited: ["x", "y"] },
    ],
    [
      ["--commit=5", "score", "--include-specs", "--json", "--now", NOW, "--workspace=/w"],
      { command: "score", includeSpecs: true },
    ],
    [
      ["--workspace", "/w", "sleep", "--apply", "--budget=900", "--gate-runs", "2000", "--json", `--now=${NOW}`, "--commit", "5"],
      { command: "sleep", apply: true, skipGate: false, gateRuns: 2000, budget: 900, block: false },
    ],
    [
      ["sleep", "--skip-gate", "--budget", "1", "--gate-runs=1", "--json", "--workspace=/w", "--now", NOW, "--commit=5"],
      { command: "sleep", apply: false, skipGate: true, gateRuns: 1, budget: 1, block: false },
    ],
    [
      ["resurrect", "--query=css rule", "--apply", "--json", "--workspace", "/w", "--now", NOW, "--commit", "5"],
      { command: "resurrect", query: "css rule", apply: true, block: false },
    ],
    [
      ["--json", "--now", NOW, "adopt", "--apply", "--workspace=/w", "--commit=5"],
      { command: "adopt", apply: true },
    ],
    [["--json", "probe", "--workspace", "/w", "--now", NOW, "--commit", "5"], { command: "probe" }],
    [["serve", "--json", "--workspace=/w", `--now=${NOW}`, "--commit=5"], { command: "serve" }],
  ])("%j", (argv, args) => {
    expect(runOf(argv)).toStrictEqual({ kind: "run", global: g, args });
  });
});

describe("usage-error classes", () => {
  it.each([
    ["no subcommand", [], "missing subcommand"],
    ["unknown subcommand", ["frobnicate"], "unknown subcommand"],
    ["unknown long flag", ["check", "--bogus"], "unknown option"],
    ["unknown short flag", ["check", "-x"], "unknown option"],
    ["missing value at end", ["check", "--scope"], "requires a value"],
    ["missing value for global", ["score", "--workspace"], "requires a value"],
    ["value starting with --", ["resurrect", "--query", "--apply"], "requires a value"],
    ["empty inline workspace", ["score", "--workspace="], "invalid value"],
    ["malformed integer (letters)", ["score", "--commit", "abc"], "invalid value"],
    ["malformed integer (fraction)", ["score", "--commit=1.5"], "invalid value"],
    ["negative commit", ["score", "--commit", "-1"], "invalid value"],
    ["zero budget", ["sleep", "--budget", "0"], "invalid value"],
    ["negative budget", ["sleep", "--budget=-5"], "invalid value"],
    ["malformed ISO --now", ["score", "--now", "yesterday"], "invalid value"],
    ["impossible ISO --now", ["score", "--now=2026-02-30T00:00:00Z"], "invalid value"],
    ["ISO --now without zone", ["score", "--now", "2026-11-20T10:00:00"], "invalid value"],
    ["resurrect without --query", ["resurrect", "--apply"], "requires --query"],
    ["empty --query", ["resurrect", "--query="], "invalid value"],
    ["record without --type", ["record", "--files", "a"], "requires --type"],
    ["record spec_cited without --cited", ["record", "--type", "spec_cited"], "non-empty --cited"],
    ["record manual_pin with empty --cited", ["record", "--type", "manual_pin", "--cited", ","], "non-empty --cited"],
    ["invalid --scope", ["check", "--scope", "nope"], "invalid value"],
    ["invalid --fail-on", ["check", "--fail-on=sometimes"], "invalid value"],
    ["invalid --type", ["record", "--type", "nope"], "invalid value"],
    ["duplicate flag", ["score", "--json", "--json"], "duplicate"],
    ["duplicate valued option (mixed forms)", ["sleep", "--budget", "1", "--budget=2"], "duplicate"],
    ["duplicate global across subcommand", ["--json", "score", "--json"], "duplicate"],
    ["flag given a value", ["sleep", "--apply=true"], "does not take a value"],
    ["extra positional", ["check", "extra"], "unexpected argument"],
    ["second subcommand", ["check", "score"], "unexpected argument"],
    ["--skip-gate with --apply", ["sleep", "--apply", "--skip-gate"], "cannot be combined"],
    ["per-command option before subcommand", ["--scope", "all", "check"], "unknown option"],
    ["option of another command", ["score", "--apply"], "unknown option"],
    ["command option on option-less command", ["probe", "--apply"], "unknown option"],
  ])("%s", (_label, argv, pattern) => {
    const r = parseArgs(argv);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message.length).toBeGreaterThan(0);
    expect(r.error.message).toContain(pattern);
    expect(r.error.hint.length).toBeGreaterThan(0);
    expect(r.error.hint).not.toContain("\n");
  });
});

describe("--gate-runs bounds", () => {
  it.each([
    ["1", 1], ["100", 100], ["10000", 10000],
  ])("accepts %s", (raw, n) => {
    expect(runOf(["sleep", "--gate-runs", raw])).toMatchObject({ args: { gateRuns: n } });
    expect(runOf(["sleep", `--gate-runs=${raw}`])).toMatchObject({ args: { gateRuns: n } });
  });

  it.each(["0", "10001", "1.5", "1e3", "-1", "abc", "0x10", " 5", ""])("rejects %j", (raw) => {
    expect(parseArgs(["sleep", `--gate-runs=${raw}`]).ok).toBe(false);
  });
});

describe("list options", () => {
  it.each([
    ["a,b", ["a", "b"]],
    [" a , ,b ", ["a", "b"]],
    ["single", ["single"]],
    ["a,,", ["a"]],
    ["", []],
  ])("--files %j splits and trims to %j", (raw, expected) => {
    const v = runOf(["record", "--type", "task_passed", "--files", raw]);
    expect(v).toMatchObject({ args: { files: expected } });
  });

  it("--cited splits and trims, in both value forms", () => {
    const a = runOf(["record", "--type", "spec_cited", "--cited", " x , y "]);
    const b = runOf(["record", "--type", "spec_cited", "--cited= x , y "]);
    expect(a).toMatchObject({ args: { cited: ["x", "y"] } });
    expect(b).toStrictEqual(a);
  });
});

describe("defaults and precedence", () => {
  it("applies global defaults and omits now/commit when absent", () => {
    const v = runOf(["score"]);
    expect(v).toMatchObject({ global: { workspace: ".", json: false } });
    expect(v.kind === "run" && "now" in v.global).toBe(false);
    expect(v.kind === "run" && "commit" in v.global).toBe(false);
  });

  it("omits budget unless given", () => {
    const v = runOf(["sleep"]);
    expect(v.kind === "run" && "budget" in v.args).toBe(false);
  });

  it("--commit 0 is accepted and kept", () => {
    expect(runOf(["score", "--commit", "0"])).toMatchObject({ global: { commit: 0 } });
  });

  it.each([
    [["--help"], { kind: "help" }],
    [["-h"], { kind: "help" }],
    [["frobnicate", "--help"], { kind: "help" }],
    [["--bogus", "-h", "--scope"], { kind: "help" }],
    [["check", "--scope", "nope", "--help"], { kind: "help", command: "check" }],
    [["-h", "sleep", "--skip-gate", "--apply"], { kind: "help", command: "sleep" }],
    [["--version"], { kind: "version" }],
    [["frobnicate", "--bogus", "--version"], { kind: "version" }],
    [["check", "--scope", "--version"], { kind: "version" }],
    [["--version", "--help"], { kind: "help" }],
  ])("%j -> %j", (argv, expected) => {
    expect(runOf(argv)).toStrictEqual(expected);
  });
});
