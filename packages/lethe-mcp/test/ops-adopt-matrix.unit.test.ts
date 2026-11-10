// Whole-workspace snapshot matrix for adoptOp. Refs: Req 23.10, Req 23.11
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { serializeTombstones, type TombstoneRecord } from "@lethe/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stubGate } from "../src/gate/gate.js";
import { adoptOp } from "../src/ops/adopt.js";
import { buildContext, type RunContext } from "../src/ops/context.js";

const NOW = "2026-11-10T12:00:00.000Z";
const LETHE = ".kiro/lethe";
let dir = "";

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-adopt-mx-")));
  mkdirSync(join(dir, ".kiro", "steering"), { recursive: true });
  mkdirSync(join(dir, ".kiro", "crypt"), { recursive: true });
  mkdirSync(join(dir, LETHE), { recursive: true });
  writeFileSync(join(dir, ".kiro", "steering", "a.md"), "## A\n\nUse ESM modules.\n\n## B\n\nUse pure CSS.\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
async function ctx(): Promise<RunContext> {
  const r = await buildContext({ workspacePath: dir, commit: 10, now: NOW }, { git: noGit, lock: { waitMs: 0 }, log: () => undefined, gate: stubGate("passed") });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

type Snap = Map<string, { bytes: string; mtime: number }>;
function snapshot(root = dir, rel = ""): Snap {
  const out: Snap = new Map();
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const r = rel === "" ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) for (const [k, v] of snapshot(root, r)) out.set(k, v);
    else out.set(r, { bytes: readFileSync(join(root, r)).toString("base64"), mtime: statSync(join(root, r)).mtimeMs });
  }
  return out;
}
const changed = (a: Snap, b: Snap): string[] =>
  [...new Set([...a.keys(), ...b.keys()])].filter((k) => JSON.stringify(a.get(k)) !== JSON.stringify(b.get(k))).sort();
const pause = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
const ledgerLine = (commit: number): string =>
  `${JSON.stringify({ type: "task_passed", at: "2026-11-01T00:00:00.000Z", commit, filesTouched: ["src/x.ts"] })}\n`;
const stateOf = (): { ledger: { lines: number }; engrams: Record<string, unknown> } =>
  JSON.parse(readFileSync(join(dir, LETHE, "state.json"), "utf8")) as { ledger: { lines: number }; engrams: Record<string, unknown> };

function tomb(id: string): TombstoneRecord {
  return {
    schema: 1, id, file: ".kiro/steering/a.md", headingPath: ["B"], body: "Use pure CSS.\n", raw: "## B\n\nUse pure CSS.\n",
    contentHash: "0".repeat(64), tokens: 4, meta: { globs: [], specLinks: [], pinned: false },
    state: { id, stability: 5, lastReinforcedCommit: 1, lastReinforcedAt: "2026-01-01T00:00:00.000Z", reinforcements: 0 },
    reason: "decayed", retentionAtDeath: 0.1, buriedAtCommit: 2, buriedAt: "2026-01-02T00:00:00.000Z", position: { index: 1 },
  };
}

async function seedAdopted(): Promise<void> {
  const r = await adoptOp(await ctx(), { apply: true });
  expect(r.ok).toBe(true);
  writeFileSync(join(dir, LETHE, "ledger.jsonl"), ledgerLine(3) + ledgerLine(4));
  writeFileSync(join(dir, ".kiro", "crypt", "tombstones.json"), serializeTombstones([]));
}

describe("adoptOp snapshot matrix", () => {
  it("dry-run leaves every file's bytes and mtime untouched", async () => {
    await seedAdopted();
    await pause();
    const before = snapshot();
    const r = await adoptOp(await ctx(), { apply: false });
    expect(r.ok && r.value.foldedEvents).toBeGreaterThan(0);
    expect(changed(before, snapshot())).toEqual([]);
  });

  it("apply changes exactly state.json: no backup, pending.json or lock", async () => {
    await seedAdopted();
    await pause();
    const before = snapshot();
    const r = await adoptOp(await ctx(), { apply: true });
    expect(r.ok).toBe(true);
    expect(changed(before, snapshot())).toEqual([`${LETHE}/state.json`]);
    expect(existsSync(join(dir, LETHE, "backup"))).toBe(false);
    expect(existsSync(join(dir, LETHE, "pending.json"))).toBe(false);
    expect(existsSync(join(dir, LETHE, "lock"))).toBe(false);
  });

  it("second apply with the same commit and now writes nothing at all", async () => {
    await seedAdopted();
    await adoptOp(await ctx(), { apply: true });
    await pause();
    const before = snapshot();
    const again = await adoptOp(await ctx(), { apply: true });
    expect(again.ok && again.value.foldedEvents).toBe(0);
    expect(changed(before, snapshot())).toEqual([]);
    expect(existsSync(join(dir, LETHE, "backup"))).toBe(false);
  });

  it("apply folds ledger events, advances the cursor, and prunes archived ids", async () => {
    await seedAdopted();
    const ids = Object.keys(stateOf().engrams).sort();
    expect(ids.length).toBe(2);
    const victim = ids[0] as string;
    writeFileSync(join(dir, ".kiro", "crypt", "tombstones.json"), serializeTombstones([tomb(victim)]));
    const r = await adoptOp(await ctx(), { apply: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.foldedEvents).toBeGreaterThan(0);
    expect(r.value.pruned).toEqual([victim]);
    const state = stateOf();
    expect(state.ledger.lines).toBe(2);
    expect(Object.keys(state.engrams)).toEqual(ids.filter((i) => i !== victim));
  });

  it("returns LOCKED and writes nothing when a live foreign lock is held", async () => {
    await seedAdopted();
    const holder = { pid: process.pid, host: hostname(), startedAt: new Date().toISOString(), token: "foreign" };
    writeFileSync(join(dir, LETHE, "lock"), JSON.stringify(holder));
    await pause();
    const before = snapshot();
    const r = await adoptOp(await ctx(), { apply: true });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("LOCKED");
    expect(changed(before, snapshot())).toEqual([]);
  });
});
