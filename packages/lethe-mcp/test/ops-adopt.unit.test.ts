// Focused unit tests for ops/adopt.ts. Refs: Req 23.11, Req 10.7
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stubGate } from "../src/gate/gate.js";
import { adoptOp, adoptSummary } from "../src/ops/adopt.js";
import { buildContext, type RunContext } from "../src/ops/context.js";

const NOW = "2026-11-10T12:00:00.000Z";
let dir = "";

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-adopt-")));
  mkdirSync(join(dir, ".kiro", "steering"), { recursive: true });
  writeFileSync(join(dir, ".kiro", "steering", "a.md"), "## A\n\nUse ESM modules.\n\n## B\n\nUse pure CSS.\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
async function ctx(): Promise<RunContext> {
  const r = await buildContext({ workspacePath: dir, commit: 10, now: NOW }, { git: noGit, lock: { waitMs: 0 }, log: () => undefined, gate: stubGate("passed") });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
const statePath = (): string => join(dir, ".kiro", "lethe", "state.json");
const lethe = (): string[] => (existsSync(join(dir, ".kiro", "lethe")) ? readdirSync(join(dir, ".kiro", "lethe")).sort() : []);

describe("adoptOp", () => {
  it("dry-run reports stamped ids and writes nothing", async () => {
    const r = await adoptOp(await ctx(), { apply: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stamped.length).toBe(2);
    expect([...r.value.stamped]).toEqual([...r.value.stamped].sort());
    expect(r.value.foldedEvents).toBe(0);
    expect(r.value.pruned).toEqual([]);
    expect(existsSync(statePath())).toBe(false);
    expect(lethe()).toEqual([]);
  });

  it("apply writes only state.json, no backup dir, no leftover lock", async () => {
    const dry = await adoptOp(await ctx(), { apply: false });
    const r = await adoptOp(await ctx(), { apply: true });
    expect(r.ok && dry.ok && r.value).toEqual(dry.ok ? dry.value : undefined);
    expect(lethe()).toEqual(["state.json"]);
    const state = JSON.parse(readFileSync(statePath(), "utf8")) as { commit: number; engrams: Record<string, unknown> };
    expect(state.commit).toBe(10);
    expect(Object.keys(state.engrams).length).toBe(2);
  });

  it("a second apply stamps nothing and leaves state.json byte-identical", async () => {
    await adoptOp(await ctx(), { apply: true });
    const before = readFileSync(statePath(), "utf8");
    const again = await adoptOp(await ctx(), { apply: true });
    expect(again.ok && again.value.stamped).toEqual([]);
    expect(readFileSync(statePath(), "utf8")).toBe(before);
  });

  it("summary differs for dry-run and apply", () => {
    const d = { stamped: ["x"], foldedEvents: 0, pruned: [] };
    expect(adoptSummary(d, false)).toContain("--apply");
    expect(adoptSummary(d, true)).toContain("state.json updated");
  });
});
