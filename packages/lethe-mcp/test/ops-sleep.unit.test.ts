// Focused unit tests for ops/sleep.ts + ops/sleep-plan.ts (dry-run). Refs: Req 4.2, 4.3, 4.4, 4.5, 4.7, 14.1
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stubGate, type GateRunner } from "../src/gate/gate.js";
import { buildContext, type RunContext } from "../src/ops/context.js";
import { sleepOp, sleepSummary, type SleepOpInput } from "../src/ops/sleep.js";

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
  "## Loose rule two",
  "",
  "Name tests after the behaviour they check, in plain words, always.",
  "",
].join("\n");
let dir = "";

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-sleep-")));
  mkdirSync(join(dir, ".kiro", "steering"), { recursive: true });
  writeFileSync(join(dir, STEERING), TEXT);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
async function ctx(gate: GateRunner = stubGate("passed")): Promise<RunContext> {
  const r = await buildContext({ workspacePath: dir, commit: 10, now: NOW }, { git: noGit, lock: { waitMs: 0 }, log: () => undefined, gate });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
const input = (over: Partial<SleepOpInput> = {}): SleepOpInput => ({ apply: false, skipGate: false, gateRuns: 100, ...over });
const tree = (): string[] => readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();

describe("sleepOp dry-run", () => {
  it("returns the would-be result, runs the gate, and writes nothing", async () => {
    const before = tree();
    const r = await sleepOp(await ctx(), input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.applied).toBe(false);
    expect(r.value.pbtGate).toBe("passed");
    expect(r.value.budget).toBe(4000);
    expect(r.value.budgetStatus).toBe("ok");
    expect(r.value.commit).toBe(10);
    expect(r.value.now).toBe(NOW);
    expect(r.value.checkpoint.stamped.length).toBe(3);
    expect(r.value.tokensBefore).toBeGreaterThan(0);
    expect(r.value.diagnostics.map((d) => d.code)).toContain("FIRST_SEEN_SYNTHESISED");
    expect(tree()).toEqual(before);
    expect(readFileSync(join(dir, STEERING), "utf8")).toBe(TEXT);
  });

  it("passes gateRuns to the gate and reports a gate failure with ok: true", async () => {
    const seen: number[] = [];
    const failing: GateRunner = async (_cfg, n) => {
      seen.push(n);
      return { status: "failed", failure: { status: "failed", propertyId: "P8", seed: 7, counterexample: [1], message: "boom" } };
    };
    const r = await sleepOp(await ctx(failing), input({ gateRuns: 25 }));
    expect(seen).toEqual([25]);
    expect(r.ok && r.value.pbtGate).toBe("failed");
    expect(r.ok && r.value.gateFailure).toEqual({ propertyId: "P8", seed: 7, counterexample: [1] });
  });

  it("skipGate marks the gate skipped without calling it", async () => {
    let calls = 0;
    const gate: GateRunner = async () => {
      calls += 1;
      return { status: "passed", ran: 12, numRuns: 1 };
    };
    const r = await sleepOp(await ctx(gate), input({ skipGate: true }));
    expect(calls).toBe(0);
    expect(r.ok && r.value.pbtGate).toBe("skipped");
  });

  it("rejects skipGate together with apply before any work", async () => {
    const r = await sleepOp(await ctx(), input({ apply: true, skipGate: true }));
    expect(!r.ok && r.error.code).toBe("INVALID_INPUT");
    expect(tree().some((p) => p.includes("lethe"))).toBe(false);
  });

  it("budgetTokens overrides the budget for this call only", async () => {
    const small = await sleepOp(await ctx(), input({ budgetTokens: 30 }));
    expect(small.ok && small.value.budget).toBe(30);
    const after = await sleepOp(await ctx(), input());
    expect(after.ok && after.value.budget).toBe(4000);
    expect(tree().some((p) => p.endsWith("config.json"))).toBe(false);
  });

  it("budget_infeasible is ok: true, keeps protected engrams, and is named in the summary", async () => {
    const r = await sleepOp(await ctx(), input({ budgetTokens: 1 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.budgetStatus).toBe("budget_infeasible");
    expect(r.value.archived.some((t) => t.meta.pinned)).toBe(false);
    expect(sleepSummary(r.value)).toContain("budget_infeasible");
  });

  it("rejects an invalid budget override with CONFIG_INVALID", async () => {
    const r = await sleepOp(await ctx(), input({ budgetTokens: -5 }));
    expect(!r.ok && r.error.code).toBe("CONFIG_INVALID");
  });
});
