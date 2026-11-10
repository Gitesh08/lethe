// Exit-code matrix rows driven through runCli against temp workspaces. Refs: Req 13.3, 13.4, 13.5, 13.7, 21.3
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exitCodeFor } from "../src/cli/exit-code.js";
import { fail } from "../src/envelope/envelope.js";
import { nodeAtomicFsOps } from "../src/io/workspace-fs.js";
import { FIXED, failingGate, holdLock, isOneJsonLine, makeWorkspace, noGit, putFile, runIn } from "./support/cli-harness.js";

let dir = "";
beforeEach(() => {
  dir = makeWorkspace({
    ".kiro/steering/a.md": "## A\n\nUse ESM modules.\n",
    ".kiro/steering/b.md": "## B\n\nKeep files small.\n",
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("usage errors (64)", () => {
  it("unknown flag: exit 64, error text on stderr, nothing on stdout", async () => {
    const r = await runIn(dir, ["score", "--bogus"]);
    expect(r.exitCode).toBe(64);
    expect(r.stdout).toBe("");
    expect(r.stderr).not.toBe("");
  });

  it("unknown flag with --json: one parseable line on stdout, stderr empty", async () => {
    const r = await runIn(dir, ["score", "--bogus", "--json"]);
    expect(r.exitCode).toBe(64);
    expect(isOneJsonLine(r.stdout)).toBe(true);
    expect(r.stderr).toBe("");
  });

  it("sleep --skip-gate --apply: exit 64 in both modes", async () => {
    expect((await runIn(dir, ["sleep", "--skip-gate", "--apply"])).exitCode).toBe(64);
    const j = await runIn(dir, ["sleep", "--skip-gate", "--apply", "--json"]);
    expect(j.exitCode).toBe(64);
    expect(isOneJsonLine(j.stdout)).toBe(true);
  });
});

describe("INTERNAL_ERROR (70)", () => {
  const boom = { git: { commitCount: async () => { throw new Error("secret-detail at /x/y.ts:1"); }, changedFiles: noGit.changedFiles } };

  it("a throwing dependency yields 70 with a generic message and no stack", async () => {
    const r = await runIn(dir, ["score", "--now", FIXED[3]], boom);
    expect(r.exitCode).toBe(70);
    expect(r.stdout).toBe("");
    expect(r.stderr).not.toContain("secret-detail");
    expect(r.stderr).not.toMatch(/\bat .*:\d+/);
  });

  it("with --json the envelope carries INTERNAL_ERROR and stderr stays empty", async () => {
    const r = await runIn(dir, ["score", "--json", "--now", FIXED[3]], boom);
    expect(r.exitCode).toBe(70);
    expect(isOneJsonLine(r.stdout)).toBe(true);
    expect((JSON.parse(r.stdout) as { error: { code: string } }).error.code).toBe("INTERNAL_ERROR");
    expect(r.stdout).not.toContain("secret-detail");
    expect(r.stderr).toBe("");
  });

  it("a throwing gate on sleep also yields 70", async () => {
    const gate = async (): Promise<never> => { throw new Error("gate exploded"); };
    const r = await runIn(dir, ["sleep", ...FIXED], { gate });
    expect(r.exitCode).toBe(70);
    expect(r.stderr).not.toContain("gate exploded");
  });
});

describe("IO-class errors (74)", () => {
  it("LOCKED: adopt --apply with a live foreign lock", async () => {
    holdLock(dir);
    const r = await runIn(dir, ["adopt", "--apply", "--json", ...FIXED]);
    expect(r.exitCode).toBe(74);
    expect((JSON.parse(r.stdout) as { error: { code: string } }).error.code).toBe("LOCKED");
    expect(r.stderr).toBe("");
  });

  it("IO_FAILED: adopt --apply when rename throws", async () => {
    const ops = { ...nodeAtomicFsOps, rename: async (): Promise<void> => { throw new Error("injected"); } };
    const r = await runIn(dir, ["adopt", "--apply", "--json", ...FIXED], { fsOptions: { ops } });
    expect(r.exitCode).toBe(74);
    expect((JSON.parse(r.stdout) as { error: { code: string } }).error.code).toBe("IO_FAILED");
  });

  it("CONFIG_INVALID: malformed state.json on score", async () => {
    putFile(dir, ".kiro/lethe/state.json", "{ not json");
    const r = await runIn(dir, ["score", "--json", ...FIXED]);
    expect(r.exitCode).toBe(74);
    expect((JSON.parse(r.stdout) as { error: { code: string } }).error.code).toBe("CONFIG_INVALID");
    const h = await runIn(dir, ["score", ...FIXED]);
    expect(h.exitCode).toBe(74);
    expect(h.stdout).toBe("");
    expect(h.stderr).not.toBe("");
  });

  it("PATH_ESCAPE maps to 74 (no CLI route reaches it, so asserted on the matrix directly)", () => {
    const env = fail({ code: "PATH_ESCAPE", message: "escapes workspace" });
    expect(exitCodeFor("record", env, { json: true })).toBe(74);
    expect(exitCodeFor("sleep", env, { block: true })).toBe(74);
  });
});

describe("finding-class failures (1 vs 2)", () => {
  it("sleep with a failing gate: 1 (dry-run and --apply)", async () => {
    for (const extra of [[], ["--apply"]]) {
      const r = await runIn(dir, ["sleep", ...extra, ...FIXED], { gate: failingGate });
      expect(r.exitCode, extra.join(" ")).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).not.toBe("");
    }
  });

  it("the 1 -> 2 upgrade is also asserted on the matrix", () => {
    const gateFailed = { ok: true, summary: "s", data: { pbtGate: "failed" } } as const;
    expect(exitCodeFor("sleep", gateFailed, {})).toBe(1);
    expect(exitCodeFor("sleep", gateFailed, { block: true })).toBe(2);
    const noMatch = fail({ code: "TOMBSTONE_NOT_FOUND", message: "none" });
    expect(exitCodeFor("resurrect", noMatch, {})).toBe(1);
    expect(exitCodeFor("resurrect", noMatch, { block: true })).toBe(2);
  });

  it("sleep --block with a failing gate: 2 end-to-end (dry-run and --apply)", async () => {
    for (const extra of [[], ["--apply"]]) {
      const r = await runIn(dir, ["sleep", "--block", ...extra, ...FIXED], { gate: failingGate });
      expect(r.exitCode, extra.join(" ")).toBe(2);
      expect(r.stdout).toBe("");
    }
  });

  it("resurrect --block with no match: 2 end-to-end", async () => {
    const r = await runIn(dir, ["resurrect", "--query", "nope", "--block", ...FIXED]);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).not.toBe("");
  });

  it("--block does not change a passing sleep", async () => {
    expect((await runIn(dir, ["sleep", "--block", ...FIXED])).exitCode).toBe(0);
  });
  it("sleep --apply with a failing gate leaves steering untouched", async () => {
    const before = await runIn(dir, ["score", "--json", ...FIXED]);
    await runIn(dir, ["sleep", "--apply", ...FIXED], { gate: failingGate });
    const after = await runIn(dir, ["score", "--json", ...FIXED]);
    expect(after.stdout).toBe(before.stdout);
  });

  it("resurrect with no match: 1 (stderr)", async () => {
    const r = await runIn(dir, ["resurrect", "--query", "nope", ...FIXED]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).not.toBe("");
  });
});

describe("degraded success (0)", () => {
  it("record with the lock held exits 0 and reports STATE_NOT_UPDATED", async () => {
    holdLock(dir);
    const human = await runIn(dir, ["record", "--type", "task_passed", "--files", "a.ts", ...FIXED]);
    expect(human.exitCode).toBe(0);
    // The human renderer does not list diagnostics; success text lands on stdout.
    expect(human.stdout).toContain("estimated utility");
    expect(human.stderr).toBe("");
    const json = await runIn(dir, ["record", "--type", "task_passed", "--files", "a.ts", "--json", ...FIXED]);
    expect(json.exitCode).toBe(0);
    expect(json.stdout).toContain("STATE_NOT_UPDATED");
  });
});
