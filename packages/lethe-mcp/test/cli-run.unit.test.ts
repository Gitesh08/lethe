// Unit tests for cli/run.ts. Refs: Req 13.2, 13.9, 11.3, 6.4
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/cli/run.js";
import { stubGate } from "../src/gate/gate.js";
import { LETHE_MCP_VERSION } from "../src/version.js";

const NOW = "2026-11-10T12:00:00.000Z";
const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
let dir = "";
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-cli-")));
  const put = (rel: string, text: string): void => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  put(".kiro/steering/a.md", "## A\n\nUse ESM modules.\n");
  put(".kiro/steering/b.md", "## B\n\nUse CommonJS modules.\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Fake { io: CliIo; out: string[]; err: string[]; stdinCalls: number }
function fake(stdin = ""): Fake {
  const f: Fake = { out: [], err: [], stdinCalls: 0, io: undefined as unknown as CliIo };
  f.io = {
    stdout: (t) => f.out.push(t), stderr: (t) => f.err.push(t), cwd: dir,
    readStdin: async () => { f.stdinCalls++; return stdin; },
  };
  return f;
}
const deps = { git: noGit, log: () => undefined, gate: stubGate("passed") };
const common = ["--commit", "7", "--now", NOW];

describe("runCli", () => {
  it("score --json passes --commit/--now to the op and prints one envelope", async () => {
    const f = fake();
    const r = await runCli(["score", "--json", ...common], f.io, deps);
    expect(r.exitCode).toBe(0);
    expect(f.err).toEqual([]);
    const env = JSON.parse(f.out.join("")) as { ok: boolean; data: { commit: number; now: string } };
    expect(env.data.commit).toBe(7);
    expect(env.data.now).toBe(NOW);
    expect(f.stdinCalls).toBe(0);
  });

  it("resolves --workspace against cwd", async () => {
    const f = fake();
    const sub = join(dir, "nested");
    mkdirSync(sub);
    const r = await runCli(["score", "--workspace", "nested", "--json", ...common], { ...f.io, cwd: dir }, deps);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(f.out.join("")).data.engrams).toEqual([]);
  });

  it("check exits 1 on findings (human text on stderr) and 0 with --fail-on never", async () => {
    const f = fake();
    expect((await runCli(["check", "--scope", "all", ...common], f.io, deps)).exitCode).toBe(1);
    expect(f.out).toEqual([]);
    expect(f.err.join("")).not.toBe("");
    const g = fake();
    expect((await runCli(["check", "--scope", "all", "--fail-on", "never", ...common], g.io, deps)).exitCode).toBe(0);
    expect(g.out.join("")).not.toBe("");
  });

  it("sleep, adopt, resurrect, record run in human mode on stdout at exit 0", async () => {
    for (const argv of [
      ["sleep"], ["adopt"], ["resurrect", "--query", "nothing-here"], ["record", "--type", "task_passed"],
    ]) {
      const f = fake();
      const r = await runCli([...argv, ...common], f.io, deps);
      // resurrect with no match is a finding (1); the rest succeed.
      expect(r.exitCode, argv[0]).toBe(argv[0] === "resurrect" ? 1 : 0);
      expect(f.out.join("") + f.err.join("")).not.toBe("");
      expect(f.stdinCalls).toBe(0);
    }
  });

  it("probe reads stdin and writes a capture file", async () => {
    const f = fake('{"hook_event_name":"PostTaskExec"}');
    const r = await runCli(["probe", ...common], f.io, deps);
    expect(r.exitCode).toBe(0);
    expect(f.stdinCalls).toBe(1);
    expect(readdirSync(join(dir, ".kiro", "lethe", "probe")).some((n) => n.endsWith("PostTaskExec.json"))).toBe(true);
  });

  it("converts a thrown exception to exit 70 with a generic message", async () => {
    const f = fake();
    const boom = { ...deps, git: { commitCount: async () => { throw new Error("secret detail"); }, changedFiles: noGit.changedFiles } };
    const r = await runCli(["score", ...common.slice(2)], f.io, boom);
    expect(r.exitCode).toBe(70);
    expect(f.err.join("")).not.toContain("secret detail");
    const g = fake();
    const j = await runCli(["score", "--json", "--now", NOW], g.io, boom);
    expect(j.exitCode).toBe(70);
    expect(JSON.parse(g.out.join("")).error.code).toBe("INTERNAL_ERROR");
  });

  it("help and version exit 0 on stdout", async () => {
    const f = fake();
    expect((await runCli(["--help"], f.io, deps)).exitCode).toBe(0);
    expect((await runCli(["sleep", "--help"], f.io, deps)).exitCode).toBe(0);
    expect((await runCli(["--version"], f.io, deps)).exitCode).toBe(0);
    expect(f.out.join("")).toContain(LETHE_MCP_VERSION);
    expect(f.err).toEqual([]);
  });

  it("usage errors exit 64; --json yields one envelope", async () => {
    const f = fake();
    const r = await runCli(["bogus", "--json"], f.io, deps);
    expect(r.exitCode).toBe(64);
    expect(f.out.join("").trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(f.out.join("")).ok).toBe(false);
    const g = fake();
    expect((await runCli(["sleep", "--skip-gate", "--apply"], g.io, deps)).exitCode).toBe(64);
    expect(g.err.join("")).not.toBe("");
  });

  it("serve delegates to deps.serve, else is a usage error", async () => {
    const f = fake();
    expect((await runCli(["serve"], f.io, { ...deps, serve: async () => 130 })).exitCode).toBe(130);
    expect((await runCli(["serve"], fake().io, deps)).exitCode).toBe(64);
  });
});
