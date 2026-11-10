// Focused tests for the sleep apply path. Refs: Req 4.6, 14.2, 14.3, 14.4, 8.4
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stubGate, type GateRunner } from "../src/gate/gate.js";
import { buildContext, type RunContext, type TraceStep } from "../src/ops/context.js";
import { sleepOp, type SleepOpInput } from "../src/ops/sleep.js";

const NOW = "2026-11-10T12:00:00.000Z";
const STEERING = ".kiro/steering/a.md";
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
].join("\n");
let dir = "";

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-sleep-apply-")));
  mkdirSync(join(dir, ".kiro", "steering"), { recursive: true });
  writeFileSync(join(dir, STEERING), TEXT);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
async function ctx(gate: GateRunner, trace?: (s: TraceStep) => void): Promise<RunContext> {
  const r = await buildContext(
    { workspacePath: dir, commit: 10, now: NOW },
    { git: noGit, lock: { waitMs: 0 }, log: () => undefined, gate, ...(trace === undefined ? {} : { trace }) },
  );
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
const input = (over: Partial<SleepOpInput> = {}): SleepOpInput => ({ apply: true, skipGate: false, gateRuns: 20, ...over });
const tree = (): string[] => readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();
const failing: GateRunner = async () => ({
  status: "failed",
  failure: { status: "failed", propertyId: "P8", seed: 7, counterexample: [1], message: "boom" },
});

describe("sleepOp apply", () => {
  it("writes state under the lock in order and reports applied", async () => {
    const steps: TraceStep[] = [];
    const r = await sleepOp(await ctx(stubGate("passed"), (s) => steps.push(s)), input());
    expect(r.ok && r.value.applied).toBe(true);
    expect(r.ok && r.value.pbtGate).toBe("passed");
    expect(existsSync(join(dir, ".kiro/lethe/state.json"))).toBe(true);
    expect(existsSync(join(dir, ".kiro/lethe/pending.json"))).toBe(false);
    expect(steps.indexOf("lock")).toBeLessThan(steps.indexOf("plan"));
    expect(steps.indexOf("gate")).toBeLessThan(steps.indexOf("write"));
    expect(steps[steps.length - 1]).toBe("release");
  });

  it("gate failure returns PBT_GATE_FAILED and writes only pbt-failures.json", async () => {
    const before = tree();
    const r = await sleepOp(await ctx(failing), input());
    expect(!r.ok && r.error.code).toBe("PBT_GATE_FAILED");
    const files = tree().filter((p) => !before.includes(p)).map((p) => p.replaceAll("\\", "/"));
    expect(files).toContain(".kiro/lethe/pbt-failures.json");
    expect(files.some((p) => p.endsWith("state.json") || p.includes("backup") || p.includes("tombstones"))).toBe(false);
    expect(readFileSync(join(dir, STEERING), "utf8")).toBe(TEXT);
    expect(readFileSync(join(dir, ".kiro/lethe/pbt-failures.json"), "utf8")).toContain("P8");
  });

  it("passes gateRuns to the runner and puts propertyId, seed, counterexample in the failure detail", async () => {
    const seen: number[] = [];
    const gate: GateRunner = async (cfg, n) => {
      seen.push(n);
      return failing(cfg, n);
    };
    const r = await sleepOp(await ctx(gate), input({ gateRuns: 37 }));
    expect(seen).toEqual([37]);
    expect(!r.ok && r.error.detail).toMatchObject({ propertyId: "P8", seed: 7, counterexample: [1] });
  });

  it("dry-run gate failure still returns ok when the lock is held elsewhere", async () => {
    mkdirSync(join(dir, ".kiro", "lethe"), { recursive: true });
    const held = await ctx(stubGate("passed"));
    const { withLock } = await import("../src/io/lock.js");
    const r = await withLock(held.fsx, held.lock, async () => sleepOp(await ctx(failing), input({ apply: false })));
    expect(r.ok && r.value.ok && r.value.value.pbtGate).toBe("failed");
  });

  it("does not persist a budget override", async () => {
    await sleepOp(await ctx(stubGate("passed")), input({ budgetTokens: 30 }));
    expect(existsSync(join(dir, ".kiro/lethe/config.json"))).toBe(false);
  });

  it("malformed tombstones give CONFIG_INVALID and nothing is rewritten", async () => {
    mkdirSync(join(dir, ".kiro", "crypt"), { recursive: true });
    writeFileSync(join(dir, ".kiro/crypt/tombstones.json"), "{not json");
    const r = await sleepOp(await ctx(stubGate("passed")), input());
    expect(!r.ok && r.error.code).toBe("CONFIG_INVALID");
    expect(readFileSync(join(dir, ".kiro/crypt/tombstones.json"), "utf8")).toBe("{not json");
    expect(existsSync(join(dir, ".kiro/lethe/state.json"))).toBe(false);
  });
});
