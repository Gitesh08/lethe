// Focused unit tests for ops/score.ts and ops/view.ts. Refs: Req 2.3, 2.4, 2.5, 23.5, 23.12, 23.13
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildContext } from "../src/ops/context.js";
import { scoreMemories, type ScoreData } from "../src/ops/score.js";

const NOW = "2026-11-10T12:00:00.000Z";
const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
let dir = "";

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-score-")));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const put = (rel: string, text: string): void => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

const seed = (): void => {
  put(".kiro/steering/b.md", "## B\n\nUse pure CSS.\n");
  put(".kiro/steering/a.md", "## A\n\nUse ESM modules.\n");
  put(".kiro/specs/s1/requirements.md", "## R\n\nThe code SHALL use ESM modules. <!-- REQ-X-1 -->\n");
};

async function run(commit: number, includeSpecs = false): Promise<{ summary: string; data: ScoreData }> {
  const c = await buildContext({ workspacePath: dir, commit, now: NOW }, { git: noGit, log: () => undefined });
  if (!c.ok) throw new Error(c.error.message);
  const env = await scoreMemories(c.value, { includeSpecs });
  if (!env.ok) throw new Error(env.error.message);
  return env;
}

const snapshot = (): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" }).sort().map((p) => {
    try { return `${p}:${readFileSync(join(dir, p), "utf8")}`; } catch { return p; }
  });

describe("scoreMemories", () => {
  it("scores a small workspace ordered by id, synthesised, writing nothing", async () => {
    seed();
    const before = snapshot();
    const { data, summary } = await run(5);
    const ids = data.engrams.map((e) => e.node.id);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toHaveLength(2);
    expect(data.engrams.every((e) => e.firstSeen === "synthesised" && e.tier === "hot" && e.retention === 1)).toBe(true);
    expect(data.engrams[0]?.node).not.toHaveProperty("body");
    expect(data.tiers).toEqual({ hot: 2, warm: 0, crypt: 0 });
    expect(data.hotTokens).toBe(data.engrams.reduce((n, e) => n + e.node.tokens, 0));
    expect(data.budget).toBe(4000);
    expect(data.budgetStatus).toBe("ok");
    expect(data.commit).toBe(5);
    expect(data.commitSource).toBe("override");
    const d = data.diagnostics.filter((x) => x.code === "FIRST_SEEN_SYNTHESISED");
    expect(d).toHaveLength(1);
    expect(d[0]?.message).toContain("2 steering engrams");
    expect(summary).toContain("2 engrams");
    expect(snapshot()).toEqual(before);
  });

  it("is byte-identical across calls for fixed commit and now", async () => {
    seed();
    const a = await run(5, true);
    const b = await run(5, true);
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
  });

  it("marks persisted engrams, includes specs as synthesised and excludes them from the count", async () => {
    seed();
    const first = await run(5, true);
    const a = first.data.engrams.find((e) => e.node.file.endsWith("a.md"));
    if (a === undefined) throw new Error("missing a.md engram");
    put(".kiro/lethe/state.json", JSON.stringify({
      version: 1, commit: 1, at: NOW, ledger: { lines: 0, bytes: 0, lastLineSha256: null },
      engrams: { [a.node.id]: { stability: 5, lastReinforcedCommit: 0, lastReinforcedAt: NOW, reinforcements: 0 } },
    }));
    const { data } = await run(5, true);
    expect(data.engrams).toHaveLength(3);
    const seen = (f: string) => data.engrams.find((e) => e.node.file.includes(f))?.firstSeen;
    expect(seen("a.md")).toBe("persisted");
    expect(seen("b.md")).toBe("synthesised");
    expect(seen("requirements.md")).toBe("synthesised");
    const msg = data.diagnostics.find((x) => x.code === "FIRST_SEEN_SYNTHESISED")?.message ?? "";
    expect(msg).toContain("1 steering engrams");
    expect(data.engrams.find((e) => e.node.file.includes("a.md"))?.deltaC).toBe(5);
  });

  it("raises COMMIT_BEFORE_CHECKPOINT without failing", async () => {
    seed();
    put(".kiro/lethe/state.json", JSON.stringify({
      version: 1, commit: 50, at: NOW, ledger: { lines: 0, bytes: 0, lastLineSha256: null }, engrams: {},
    }));
    const { data } = await run(10);
    expect(data.diagnostics.map((d) => d.code)).toContain("COMMIT_BEFORE_CHECKPOINT");
    expect(data.engrams).toHaveLength(2);
  });
});
