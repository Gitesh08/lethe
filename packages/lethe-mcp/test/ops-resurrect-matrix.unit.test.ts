// Rule-precedence and failure matrix for ops/resurrect.ts. Refs: Req 5.2, 8.6, 8.9
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, resurrect, serializeTombstones, type TombstoneRecord } from "@lethe/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nodeAtomicFsOps } from "../src/io/workspace-fs.js";
import { buildContext, type ContextDeps, type RunContext } from "../src/ops/context.js";
import { MAX_RESURRECT_MATCHES, matchTombstones, resurrectOp } from "../src/ops/resurrect.js";

const NOW = "2026-11-10T12:00:00.000Z";
const FILE = ".kiro/steering/a.md";
const TOMBS = ".kiro/crypt/tombstones.json";
let dir = "";

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-resm-")));
  mkdirSync(join(dir, ".kiro", "steering"), { recursive: true });
  mkdirSync(join(dir, ".kiro", "crypt"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function tomb(id: string, raw: string, file = FILE, commit = 1): TombstoneRecord {
  return {
    schema: 1, id, file, headingPath: [id], body: raw, raw, contentHash: "0".repeat(64), tokens: 3,
    meta: { globs: [], specLinks: [], pinned: false },
    state: { id, stability: 9, lastReinforcedCommit: 1, lastReinforcedAt: "2026-01-01T00:00:00.000Z", reinforcements: 4 },
    reason: "decayed", retentionAtDeath: 0.1, buriedAtCommit: commit, buriedAt: "2026-01-02T00:00:00.000Z",
    position: { index: 1 },
  };
}

function seed(tombs: readonly TombstoneRecord[], steering = "# A\n\n## Keep\nKeep me.\n"): void {
  writeFileSync(join(dir, TOMBS), serializeTombstones([...tombs]));
  writeFileSync(join(dir, FILE), steering);
}

async function ctx(extra: ContextDeps = {}): Promise<RunContext> {
  const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
  const r = await buildContext({ workspacePath: dir, commit: 50, now: NOW }, { git: noGit, lock: { waitMs: 0 }, log: () => undefined, ...extra });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

const ids = (m: readonly TombstoneRecord[]): string[] => m.map((t) => t.id);
const bytes = (rel: string): Buffer => readFileSync(join(dir, rel));

describe("resurrectOp rule precedence", () => {
  const byId = tomb("redux", "## Redux\nx\n");
  const byText = tomb("other", "## Other\nmentions redux here\n", ".kiro/steering/b.md", 2);

  it("a query matching one id and another body returns only the id match", async () => {
    seed([byId, byText]);
    const r = await resurrectOp(await ctx(), { query: "redux", apply: false });
    expect(r.ok && ids(r.value.matches)).toEqual(["redux"]);
  });

  it("a glob that matches no file falls through to a substring hit", async () => {
    seed([tomb("p", "## P\nsee src/state for details\n")]);
    const r = await resurrectOp(await ctx(), { query: "src/state", apply: false });
    expect(r.ok && ids(r.value.matches)).toEqual(["p"]);
  });

  it("a plain query uses substring over id and body", async () => {
    seed([byId, byText]);
    const r = await resurrectOp(await ctx(), { query: "mentions", apply: false });
    expect(r.ok && ids(r.value.matches)).toEqual(["other"]);
  });

  it("a glob hit decides before substring", () => {
    const g = tomb("g", "## G\nnothing\n", ".kiro/steering/b.md");
    const s = tomb("s", "## S\nmentions .kiro/steering/b.md\n");
    expect(ids(matchTombstones([s, g], ".kiro/steering/b.md"))).toEqual(["g"]);
  });
});

describe("matchTombstones globs", () => {
  const t1 = tomb("one", "## One\n", ".kiro/steering/a.md");
  const t2 = tomb("two", "## Two\n", ".kiro/steering/ab.md");
  const t3 = tomb("three", "## Three\n", ".kiro/specs/x/design.md");

  it("? matches exactly one character", () => {
    expect(ids(matchTombstones([t1, t2, t3], ".kiro/steering/?.md"))).toEqual(["one"]);
  });

  it("** crosses directories", () => {
    expect(ids(matchTombstones([t1, t2, t3], ".kiro/**/*.md")).sort()).toEqual(["one", "three", "two"]);
  });
});

describe("resurrectOp failure matrix", () => {
  it("malformed tombstones are CONFIG_INVALID on apply and leave bytes unchanged", async () => {
    seed([]);
    writeFileSync(join(dir, TOMBS), "{nope");
    const steerBefore = bytes(FILE);
    const r = await resurrectOp(await ctx(), { query: "x", apply: true });
    expect(!r.ok && r.error.code).toBe("CONFIG_INVALID");
    expect(bytes(FILE).equals(steerBefore)).toBe(true);
    expect(readFileSync(join(dir, TOMBS), "utf8")).toBe("{nope");
  });

  it("an injected write failure restores everything and leaves no journal", async () => {
    seed([tomb("a-redux", "## Redux\nUse Redux.\n")]);
    mkdirSync(join(dir, ".kiro", "lethe"), { recursive: true });
    const before = [FILE, TOMBS].map(bytes);
    let failed = false;
    const ops = {
      ...nodeAtomicFsOps,
      rename: async (from: string, to: string): Promise<void> => {
        if (!failed && to.endsWith("a.md")) {
          failed = true;
          throw new Error("injected");
        }
        return nodeAtomicFsOps.rename(from, to);
      },
    };
    const r = await resurrectOp(await ctx({ fsOptions: { ops } }), { query: "a-redux", apply: true });
    expect(failed).toBe(true);
    expect(!r.ok && r.error.code).toBe("IO_FAILED");
    expect([FILE, TOMBS].map(bytes).every((b, i) => b.equals(before[i] as Buffer))).toBe(true);
    expect(existsSync(join(dir, ".kiro", "lethe", "state.json"))).toBe(false);
    expect(existsSync(join(dir, ".kiro", "lethe", "pending.json"))).toBe(false);
  });

  it("restores into a CRLF + BOM file byte-exact", async () => {
    const text = "\uFEFF# A\r\n\r\n## Keep\r\nKeep me.\r\n";
    const t = tomb("a-redux", "## Redux\r\nUse Redux for state.\r\n");
    seed([t], text);
    const expected = resurrect({ files: new Map([[FILE, text]]), tombstones: [t] }, t, 50, NOW, DEFAULT_CONFIG);
    expect(expected.ok).toBe(true);
    const r = await resurrectOp(await ctx(), { query: "a-redux", apply: true });
    expect(r.ok).toBe(true);
    const want = expected.ok ? expected.value.workspace.files.get(FILE) : undefined;
    expect(bytes(FILE).equals(Buffer.from(want ?? "", "utf8"))).toBe(true);
    expect(bytes(FILE).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
    expect(bytes(FILE).includes(Buffer.from(t.raw, "utf8"))).toBe(true);
  });

  it("lists more than the cap on dry-run but rejects apply", async () => {
    const many = Array.from({ length: MAX_RESURRECT_MATCHES + 1 }, (_, i) => tomb(`m-${String(i).padStart(2, "0")}`, `## M${String(i)}\nbody\n`, FILE, i));
    seed(many);
    const dry = await resurrectOp(await ctx(), { query: "m-", apply: false });
    expect(dry.ok && dry.value.matches.length).toBe(MAX_RESURRECT_MATCHES + 1);
    const before = bytes(FILE);
    const app = await resurrectOp(await ctx(), { query: "m-", apply: true });
    expect(!app.ok && app.error.code).toBe("INVALID_INPUT");
    expect(bytes(FILE).equals(before)).toBe(true);
  });
});
