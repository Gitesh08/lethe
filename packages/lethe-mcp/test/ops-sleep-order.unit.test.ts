// sleepOp ordering and gate behaviour (task 7.8). Refs: Req 4.2, 4.4, 4.5, 4.6, 14.2
// The task text names the last step "unlock"; the implementation's trace step is "release".
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AtomicFsOps } from "../src/io/atomic-write.js";
import { nodeAtomicFsOps } from "../src/io/workspace-fs.js";
import { stubGate, type GateRunner } from "../src/gate/gate.js";
import { buildContext, type RunContext, type TraceStep } from "../src/ops/context.js";
import { sleepOp, type SleepOpInput } from "../src/ops/sleep.js";

const NOW = "2026-11-10T12:00:00.000Z";
const STEERING = ".kiro/steering/a.md";
const STATE = ".kiro/lethe/state.json";
const LOCK = ".kiro/lethe/lock";
const FAILS = ".kiro/lethe/pbt-failures.json";
const TEXT = [
  "## Pinned rule",
  "<!-- lethe: pin=true -->",
  "",
  "Always keep this pinned rule around for the whole project lifetime.",
  "",
  "## Loose rule one",
  "",
  "Prefer small functions and short files in every module of the codebase.",
  "",
  "## Loose rule two",
  "",
  "Name tests after the behaviour they check, in plain words, always.",
  "",
  "## Loose rule three",
  "",
  "Write commit messages that explain the reason for each change made.",
  "",
].join("\n");
const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
const failing: GateRunner = async () => ({
  status: "failed",
  failure: { status: "failed", propertyId: "P8", seed: 7, counterexample: [1], message: "boom" },
});
let dir = "";
let events: string[] = [];
let steps: TraceStep[] = [];

const norm = (p: string): string => relative(dir, p).replaceAll("\\", "/");
function recordingOps(): AtomicFsOps {
  const o = nodeAtomicFsOps;
  return {
    ...o,
    mkdirp: (d) => (events.push(`mkdirp:${norm(d)}`), o.mkdirp(d)),
    rename: (a, b) => (events.push(`rename:${norm(b)}`), o.rename(a, b)),
    unlink: (p) => (events.push(`unlink:${norm(p)}`), o.unlink(p)),
  };
}
async function ctx(gate: GateRunner = stubGate("passed"), record = true): Promise<RunContext> {
  const r = await buildContext(
    { workspacePath: dir, commit: 10, now: NOW },
    {
      git: noGit,
      lock: { waitMs: 0 },
      log: () => undefined,
      gate,
      ...(record ? { trace: (s: TraceStep) => void steps.push(s), fsOptions: { ops: recordingOps() } } : {}),
    },
  );
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
const input = (over: Partial<SleepOpInput> = {}): SleepOpInput => ({ apply: true, skipGate: false, gateRuns: 20, ...over });
const files = (): Map<string, string> => {
  const m = new Map<string, string>();
  for (const p of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const abs = join(dir, p);
    if (existsSync(abs) && !readdirSyncSafe(abs)) m.set(p.replaceAll("\\", "/"), readFileSync(abs, "utf8"));
  }
  return m;
};
const readdirSyncSafe = (abs: string): boolean => {
  try {
    readdirSync(abs);
    return true;
  } catch {
    return false;
  }
};
const newKeys = (before: Map<string, string>): string[] => [...files().keys()].filter((k) => !before.has(k));
const changedKeys = (before: Map<string, string>): string[] => [...before].filter(([k, v]) => files().get(k) !== v).map(([k]) => k);

beforeEach(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-sleep-order-")));
  events = [];
  steps = [];
  mkdirSync(join(dir, ".kiro", "steering"), { recursive: true });
  writeFileSync(join(dir, STEERING), TEXT);
  // Discover ids with a dry run, then seed a checkpoint that makes every unpinned rule decay into the crypt.
  const probe = await sleepOp(await ctx(stubGate("passed"), false), input({ apply: false }));
  if (!probe.ok) throw new Error(probe.error.message);
  const engrams: Record<string, unknown> = {};
  for (const id of probe.value.checkpoint.stamped) {
    if (!id.includes("pinned")) engrams[id] = { stability: 0.5, lastReinforcedCommit: 0, lastReinforcedAt: NOW, reinforcements: 0 };
  }
  const ledger = { lines: 0, bytes: 0, lastLineSha256: null };
  mkdirSync(join(dir, ".kiro", "lethe"), { recursive: true });
  writeFileSync(join(dir, STATE), JSON.stringify({ version: 1, commit: 10, at: NOW, ledger, engrams }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("sleepOp ordering", () => {
  it("runs lock, recover, load, plan, gate, backup, write, release in order", async () => {
    let lockAtGate: boolean | undefined;
    const gate: GateRunner = async () => {
      events.push("gate");
      lockAtGate = existsSync(join(dir, LOCK));
      return { status: "passed", ran: 12, numRuns: 20 };
    };
    const r = await sleepOp(await ctx(gate), input());
    expect(r.ok && r.value.applied).toBe(true);
    expect(r.ok && r.value.archived.length).toBe(3);
    expect(steps).toEqual(["lock", "recover", "load", "body", "plan", "gate", "backup", "write", "release"]);
    const gateAt = events.indexOf("gate");
    const backupAt = events.findIndex((e) => e.includes(".kiro/lethe/backup/"));
    const targets = [STEERING, ".kiro/crypt/tombstones.json", STATE].map((t) => events.indexOf(`rename:${t}`));
    expect(lockAtGate).toBe(true);
    expect(gateAt).toBeGreaterThanOrEqual(0);
    expect(backupAt).toBeGreaterThan(gateAt);
    for (const t of targets) expect(t).toBeGreaterThan(backupAt);
    expect(events[events.length - 1]).toBe(`unlink:${LOCK}`);
    expect(existsSync(join(dir, LOCK))).toBe(false);
  });
});

describe("sleepOp gate failure", () => {
  it("apply: no backup, no target writes, only pbt-failures.json is new", async () => {
    const before = files();
    const r = await sleepOp(await ctx(failing), input());
    expect(!r.ok && r.error.code).toBe("PBT_GATE_FAILED");
    expect(newKeys(before)).toEqual([FAILS]);
    expect(changedKeys(before)).toEqual([]);
    expect(existsSync(join(dir, ".kiro/lethe/backup"))).toBe(false);
    expect(events.some((e) => e.includes("backup"))).toBe(false);
    const renames = events.filter((e) => e.startsWith("rename:"));
    expect(renames).toEqual([`rename:${FAILS}`]);
    expect(steps).not.toContain("backup");
    expect(steps).not.toContain("write");
    expect(steps[steps.length - 1]).toBe("release");
  });

  it("dry-run with a passing gate modifies nothing and touches no fs op", async () => {
    const before = files();
    const r = await sleepOp(await ctx(), input({ apply: false }));
    expect(r.ok && r.value.applied).toBe(false);
    expect(newKeys(before)).toEqual([]);
    expect(changedKeys(before)).toEqual([]);
    expect(events).toEqual([]);
  });

  it("dry-run with a failing gate records only pbt-failures.json (Req 14.2/14.4)", async () => {
    const before = files();
    const r = await sleepOp(await ctx(failing), input({ apply: false }));
    expect(r.ok && r.value.pbtGate).toBe("failed");
    expect(newKeys(before)).toEqual([FAILS]);
    expect(changedKeys(before)).toEqual([]);
    expect(readFileSync(join(dir, FAILS), "utf8")).toContain("P8");
  });
});

describe("sleepOp budget override and skipGate", () => {
  it("budgetTokens applies to one call and is never persisted", async () => {
    const small = await sleepOp(await ctx(), input({ apply: false, budgetTokens: 1 }));
    expect(small.ok && small.value.budget).toBe(1);
    expect(small.ok && small.value.budgetStatus).toBe("budget_infeasible");
    const applied = await sleepOp(await ctx(), input({ budgetTokens: 1 }));
    expect(applied.ok && applied.value.applied).toBe(true);
    expect(existsSync(join(dir, ".kiro/lethe/config.json"))).toBe(false);
    expect(readFileSync(join(dir, STATE), "utf8")).not.toContain("budget");
    const next = await sleepOp(await ctx(), input({ apply: false }));
    expect(next.ok && next.value.budget).toBe(4000);
    expect(next.ok && next.value.budgetStatus).toBe("ok");
  });

  it("skipGate with apply is INVALID_INPUT before any fs call or step", async () => {
    const before = files();
    const r = await sleepOp(await ctx(), input({ skipGate: true }));
    expect(!r.ok && r.error.code).toBe("INVALID_INPUT");
    expect(events).toEqual([]);
    expect(steps).toEqual([]);
    expect(newKeys(before)).toEqual([]);
  });
});
