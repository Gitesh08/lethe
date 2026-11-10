// Unit tests for ops/resurrect.ts. Refs: Req 5.2, 5.3, 5.4, 5.5, REQ-CRY-7
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, serializeTombstones, type TombstoneRecord } from "@lethe/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildContext, type RunContext } from "../src/ops/context.js";
import { resurrectOp } from "../src/ops/resurrect.js";

const NOW = "2026-11-10T12:00:00.000Z";
const FILE = ".kiro/steering/a.md";
let dir = "";

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-res-")));
  mkdirSync(join(dir, ".kiro", "steering"), { recursive: true });
  mkdirSync(join(dir, ".kiro", "crypt"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function tomb(id: string, file: string, raw: string, commit: number): TombstoneRecord {
  return {
    schema: 1, id, file, headingPath: [id], body: raw, raw, contentHash: "0".repeat(64), tokens: 3,
    meta: { globs: [], specLinks: [], pinned: false },
    state: { id, stability: 9, lastReinforcedCommit: 1, lastReinforcedAt: "2026-01-01T00:00:00.000Z", reinforcements: 4 },
    reason: "decayed", retentionAtDeath: 0.1, buriedAtCommit: commit, buriedAt: "2026-01-02T00:00:00.000Z",
    position: { index: 1 },
  };
}

const T_REDUX = tomb("a-redux", FILE, "## Redux\r\nUse Redux for state.\r\n", 1);
const T_CSS = tomb("b-css", ".kiro/steering/b.md", "## CSS\nUse Sass modules.\n", 2);

function seed(tombs: TombstoneRecord[]): void {
  writeFileSync(join(dir, ".kiro", "crypt", "tombstones.json"), serializeTombstones(tombs));
  writeFileSync(join(dir, FILE), "# A\n\n## Keep\nKeep me.\n");
}

async function ctx(): Promise<RunContext> {
  const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
  const r = await buildContext({ workspacePath: dir, commit: 50, now: NOW }, { git: noGit, lock: { waitMs: 0 }, log: () => undefined });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

const ids = (m: readonly TombstoneRecord[]): string[] => m.map((t) => t.id);

describe("resurrectOp dry-run", () => {
  beforeEach(() => seed([T_REDUX, T_CSS]));

  it("rule (a): exact id wins over text matches", async () => {
    const r = await resurrectOp(await ctx(), { query: "a-redux", apply: false });
    expect(r.ok && ids(r.value.matches)).toEqual(["a-redux"]);
  });

  it("rule (b): glob over file when the query has * ? or /", async () => {
    const r = await resurrectOp(await ctx(), { query: ".kiro/steering/b.*", apply: false });
    expect(r.ok && ids(r.value.matches)).toEqual(["b-css"]);
  });

  it("rule (c): case-insensitive substring over id and body", async () => {
    const byBody = await resurrectOp(await ctx(), { query: "SASS", apply: false });
    const byId = await resurrectOp(await ctx(), { query: "REDUX", apply: false });
    expect(byBody.ok && ids(byBody.value.matches)).toEqual(["b-css"]);
    expect(byId.ok && ids(byId.value.matches)).toEqual(["a-redux"]);
  });

  it("an empty glob result falls through to substring", async () => {
    const r = await resurrectOp(await ctx(), { query: "Use/", apply: false });
    expect(!r.ok && r.error.code).toBe("TOMBSTONE_NOT_FOUND");
  });

  it("no match is TOMBSTONE_NOT_FOUND and nothing is written", async () => {
    const before = readFileSync(join(dir, FILE), "utf8");
    const r = await resurrectOp(await ctx(), { query: "zzz", apply: true });
    expect(!r.ok && r.error.code).toBe("TOMBSTONE_NOT_FOUND");
    expect(readFileSync(join(dir, FILE), "utf8")).toBe(before);
  });

  it("writes nothing", async () => {
    const before = readFileSync(join(dir, FILE), "utf8");
    await resurrectOp(await ctx(), { query: "a-redux", apply: false });
    expect(readFileSync(join(dir, FILE), "utf8")).toBe(before);
  });

  it("malformed tombstones are CONFIG_INVALID", async () => {
    writeFileSync(join(dir, ".kiro", "crypt", "tombstones.json"), "{nope");
    const r = await resurrectOp(await ctx(), { query: "x", apply: false });
    expect(!r.ok && r.error.code).toBe("CONFIG_INVALID");
  });
});

describe("resurrectOp apply", () => {
  beforeEach(() => seed([T_REDUX, T_CSS]));

  it("restores byte-exact, removes only that record, and stamps a fresh state", async () => {
    const r = await resurrectOp(await ctx(), { query: "a-redux", apply: true });
    expect(r.ok && r.value.restored?.map((x) => x.id)).toEqual(["a-redux"]);
    const file = readFileSync(join(dir, FILE), "utf8");
    expect(file).toContain(T_REDUX.raw);
    const crypt = JSON.parse(readFileSync(join(dir, ".kiro", "crypt", "tombstones.json"), "utf8")) as { tombstones: { id: string }[] };
    expect(crypt.tombstones.map((t) => t.id)).toEqual(["b-css"]);
    const state = JSON.parse(readFileSync(join(dir, ".kiro", "lethe", "state.json"), "utf8")) as {
      engrams: Record<string, { stability: number; lastReinforcedCommit: number; lastReinforcedAt: string; reinforcements: number }>;
    };
    expect(state.engrams["a-redux"]).toEqual({
      stability: DEFAULT_CONFIG.s0, lastReinforcedCommit: 50, lastReinforcedAt: NOW, reinforcements: 0,
    });
  });

  it("a second apply of the same query finds nothing", async () => {
    await resurrectOp(await ctx(), { query: "a-redux", apply: true });
    const again = await resurrectOp(await ctx(), { query: "a-redux", apply: true });
    expect(!again.ok && again.error.code).toBe("TOMBSTONE_NOT_FOUND");
  });
});
