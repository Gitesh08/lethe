// Matrix tests for scoreOp: determinism, wording, ordering, read-only spy, first-seen. Refs: Req 2.5, 2.6, 2.7, 23.5
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AtomicFsOps } from "../src/io/atomic-write.js";
import { nodeAtomicFsOps } from "../src/io/workspace-fs.js";
import { adoptOp } from "../src/ops/adopt.js";
import { buildContext } from "../src/ops/context.js";
import { scoreMemories, type ScoreData } from "../src/ops/score.js";
import { KEY_ORDERS, stableLine } from "../src/persist/stable-json.js";

const NOW = "2026-11-10T12:00:00.000Z";
let dir = "";
let gitCalls: string[] = [];
const git = {
  commitCount: async () => undefined,
  changedFiles: async () => {
    gitCalls.push("changedFiles");
    return undefined;
  },
};

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-score-mx-")));
  gitCalls = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const put = (rel: string, text: string): void => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

async function ctxAt(commit: number, ops?: AtomicFsOps) {
  const c = await buildContext(
    { workspacePath: dir, commit, now: NOW },
    { git, log: () => undefined, ...(ops === undefined ? {} : { fsOptions: { ops } }) },
  );
  if (!c.ok) throw new Error(c.error.message);
  return c.value;
}

async function score(commit: number, ops?: AtomicFsOps): Promise<{ summary: string; data: ScoreData }> {
  const env = await scoreMemories(await ctxAt(commit, ops), { includeSpecs: false });
  if (!env.ok) throw new Error(env.error.message);
  return env;
}

const seed = (): void => {
  const files: Array<[string, string, string]> = [
    ["zeta", "Zeta", "Use ESM modules."], ["Beta", "Beta", "Use pure CSS."], ["alpha", "alpha", "Prefer Vitest."],
    ["10", "Ten", "Keep files small."], ["2", "Two", "Avoid any."],
  ];
  for (const [f, h, b] of files) put(`.kiro/steering/${f}.md`, `## ${h}\n\n${b}\n`);
};

describe("scoreOp matrix", () => {
  it("is byte-identical across calls with a reinforcing ledger", async () => {
    seed();
    const first = await score(5);
    const id = first.data.engrams[0]?.node.id ?? "";
    const ev = { type: "spec_cited", at: NOW, commit: 3, cited: [id] };
    put(".kiro/lethe/ledger.jsonl", stableLine(ev, KEY_ORDERS.ledgerLine));
    const a = await score(5);
    const b = await score(5);
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
    expect(a.summary).toBe(b.summary);
  });

  it("labels reinforcements as estimated utility without usefulness claims", async () => {
    seed();
    const id = (await score(5)).data.engrams[0]?.node.id ?? "";
    // Persist state with reinforcements so the summary reports them.
    put(".kiro/lethe/state.json", JSON.stringify({
      version: 1, commit: 1, at: NOW, ledger: { lines: 0, bytes: 0, lastLineSha256: null },
      engrams: { [id]: { stability: 8, lastReinforcedCommit: 1, lastReinforcedAt: NOW, reinforcements: 2 } },
    }));
    const { summary } = await score(5);
    expect(summary).toContain("estimated utility");
    expect(summary).not.toMatch(/useful|helpful/i);
  });

  it("orders ids ascending by code unit", async () => {
    seed();
    const ids = (await score(5)).data.engrams.map((e) => e.node.id);
    expect(ids.length).toBeGreaterThanOrEqual(5);
    expect(ids).toEqual([...ids].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
  });

  it("performs no fs mutation, lock or git changedFiles call", async () => {
    seed();
    put(".kiro/lethe/ledger.jsonl", stableLine({ type: "manual_pin", at: NOW, commit: 2, cited: ["x"] }, KEY_ORDERS.ledgerLine));
    const calls: string[] = [];
    const spy = new Proxy(nodeAtomicFsOps, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv) as unknown;
        if (typeof v !== "function") return v;
        return (...args: unknown[]): unknown => {
          calls.push(`${String(prop)}:${args.map((a) => (typeof a === "string" ? a : "")).join(",")}`);
          return (v as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    await score(5, spy);
    expect(calls).toEqual([]);
    expect(calls.join("\n")).not.toMatch(/lethe[\\/]lock|state\.json/);
    expect(gitCalls).toEqual([]);
  });

  it("keeps FIRST_SEEN_SYNTHESISED at 105 and 110 until adopt stamps commit 100", async () => {
    seed();
    for (const c of [105, 110]) {
      const { data } = await score(c);
      expect(data.engrams.every((e) => e.firstSeen === "synthesised" && e.retention === 1)).toBe(true);
      expect(data.diagnostics.map((d) => d.code)).toContain("FIRST_SEEN_SYNTHESISED");
    }
    const r = await adoptOp(await ctxAt(100), { apply: true });
    expect(r.ok).toBe(true);
    for (const c of [105, 110]) {
      const { data } = await score(c);
      expect(data.engrams.length).toBeGreaterThan(0);
      for (const e of data.engrams) {
        expect(e.firstSeen).toBe("persisted");
        expect(Math.abs(e.rawRetention - Math.exp(-(c - 100) / 5))).toBeLessThan(1e-12);
      }
      expect(data.diagnostics.map((d) => d.code)).not.toContain("FIRST_SEEN_SYNTHESISED");
    }
  });
});
