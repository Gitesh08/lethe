// Unit tests for applyPlan. Refs: REQ-CRY-1, REQ-CRY-2, REQ-CRY-6, INV-1, INV-3
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { applyPlan } from "../src/crypt/apply.js";
import { toTombstone } from "../src/crypt/archive.js";
import { parseDocument } from "../src/parse/document.js";
import type {
  ConsolidationPlan, EngramNode, ScoredEngram, TombstoneRecord, VirtualWorkspace,
} from "../src/types.js";

const NOW = "2026-03-01T00:00:00.000Z";
const cfg = DEFAULT_CONFIG;

function nodes(file: string, text: string): readonly EngramNode[] {
  const r = parseDocument(file, text, cfg);
  if (!r.ok) throw new Error("parse failed in test");
  return r.value.engrams;
}

function scored(node: EngramNode, isProtected = false): ScoredEngram {
  return {
    node,
    state: { id: node.id, stability: 5, lastReinforcedCommit: 1, lastReinforcedAt: NOW, reinforcements: 0 },
    deltaC: 10, weight: 1, retention: 0.1, rawRetention: 0.1,
    tier: "crypt", status: "active", protected: isProtected,
  };
}

function planOf(
  archive: readonly ScoredEngram[],
  merge: ReadonlyArray<{ keep: ScoredEngram; drop: ScoredEngram }> = [],
): ConsolidationPlan {
  return {
    toArchive: archive.map((engram) => ({ engram, reason: "decayed" as const })),
    toMerge: merge, toDemote: [], budgetStatus: "ok", tokensBefore: 0, tokensAfter: 0,
  };
}

const ws = (files: Record<string, string>, tombstones: readonly TombstoneRecord[] = []): VirtualWorkspace =>
  ({ files: new Map(Object.entries(files)), tombstones });

const TEXT = "# T\n\n## A\nalpha\n\n## B\nbeta\n\n## C\ngamma\n";
const run = (w: VirtualWorkspace, p: ConsolidationPlan) => applyPlan(w, p, 7, NOW, cfg);

describe("applyPlan", () => {
  it("buries a middle engram with exact raw, index and neighbor", () => {
    const [a, b, c] = nodes("f.md", TEXT);
    const r = run(ws({ "f.md": TEXT }), planOf([scored(b!)]));
    expect(r.workspace.files.get("f.md")).toBe(TEXT.slice(0, b!.span.start) + TEXT.slice(b!.span.end));
    expect(r.skipped).toEqual([]);
    const t = r.tombstones[0]!;
    expect(t.raw).toBe(TEXT.slice(b!.span.start, b!.span.end));
    expect(t.body).toBe(b!.body);
    expect(t.position).toEqual({ index: 1, neighborBefore: a!.id });
    expect(t.buriedAtCommit).toBe(7);
    expect(r.workspace.tombstones).toEqual([t]);
    expect(c).toBeDefined();
  });

  it("first engram has index 0 and no neighbor; last engram works", () => {
    const [a, , c] = nodes("f.md", TEXT);
    const first = run(ws({ "f.md": TEXT }), planOf([scored(a!)]));
    expect(first.tombstones[0]!.position).toEqual({ index: 0 });
    expect(Object.keys(first.tombstones[0]!.position)).toEqual(["index"]);
    const last = run(ws({ "f.md": TEXT }), planOf([scored(c!)]));
    expect(last.workspace.files.get("f.md")).toBe(TEXT.slice(0, c!.span.start));
    expect(last.tombstones[0]!.position.index).toBe(2);
  });

  it("two engrams in one file keep offsets valid (pre-apply indexes)", () => {
    const [a, b, c] = nodes("f.md", TEXT);
    const r = run(ws({ "f.md": TEXT }), planOf([scored(a!), scored(c!)]));
    expect(r.workspace.files.get("f.md")).toBe("# T\n\n" + TEXT.slice(b!.span.start, b!.span.end));
    expect(r.tombstones.map((t) => t.position.index).sort()).toEqual([0, 2]);
    const tc = r.tombstones.find((t) => t.id === c!.id)!;
    expect(tc.position.neighborBefore).toBe(b!.id);
  });

  it("handles engrams in two files", () => {
    const other = "## X\nx\n\n## Y\ny\n";
    const a = nodes("f.md", TEXT)[0]!;
    const y = nodes("g.md", other)[1]!;
    const r = run(ws({ "f.md": TEXT, "g.md": other }), planOf([scored(a), scored(y)]));
    expect(r.workspace.files.get("g.md")).toBe("## X\nx\n\n");
    expect(r.tombstones).toHaveLength(2);
  });

  it("buries merge drops as duplicate with defeatedBy = keep id", () => {
    const [a, b] = nodes("f.md", TEXT);
    const r = run(ws({ "f.md": TEXT }), planOf([], [{ keep: scored(a!), drop: scored(b!) }]));
    expect(r.tombstones[0]).toMatchObject({ id: b!.id, reason: "duplicate", defeatedBy: a!.id });
  });

  it("preserves contradiction reason and defeatedBy", () => {
    const [a, b] = nodes("f.md", TEXT);
    const plan: ConsolidationPlan = {
      ...planOf([]),
      toArchive: [{ engram: scored(b!), reason: "contradiction", defeatedBy: a!.id }],
    };
    const t = run(ws({ "f.md": TEXT }), plan).tombstones[0]!;
    expect(t.reason).toBe("contradiction");
    expect(t.defeatedBy).toBe(a!.id);
  });

  it("keeps frontmatter and CRLF byte-exact apart from removed spans", () => {
    const text = "---\r\ninclusion: always\r\n---\r\n## A\r\nalpha\r\n## B\r\nbeta\r\n";
    const [a, b] = nodes("f.md", text);
    const r = run(ws({ "f.md": text }), planOf([scored(a!)]));
    expect(r.workspace.files.get("f.md")).toBe("---\r\ninclusion: always\r\n---\r\n## B\r\nbeta\r\n");
    expect(r.tombstones[0]!.raw).toBe("## A\r\nalpha\r\n");
    expect(b).toBeDefined();
    const all = run(ws({ "f.md": text }), planOf([scored(a!), scored(b!)]));
    expect(all.workspace.files.get("f.md")).toBe("---\r\ninclusion: always\r\n---\r\n");
  });

  it("skips stale plans with span-mismatch and leaves the file untouched", () => {
    const [, b] = nodes("f.md", TEXT);
    const edited = "# T\n\nNEW LINE ADDED\n\n## A\nalpha\n\n## B\nbeta\n\n## C\ngamma\n";
    const r = run(ws({ "f.md": edited }), planOf([scored(b!)]));
    expect(r.skipped).toEqual([{ id: b!.id, reason: "span-mismatch" }]);
    expect(r.workspace.files.get("f.md")).toBe(edited);
    expect(r.tombstones).toEqual([]);
  });

  it("reports file-missing", () => {
    const a = nodes("f.md", TEXT)[0]!;
    const r = run(ws({}), planOf([scored(a)]));
    expect(r.skipped).toEqual([{ id: a.id, reason: "file-missing" }]);
    expect(r.workspace.files.size).toBe(0);
  });

  it("reports parse-failed for an unclosed frontmatter and leaves the file", () => {
    const a = nodes("f.md", TEXT)[0]!;
    const bad = "---\nfoo: bar\n## A\nalpha\n";
    const r = run(ws({ "f.md": bad }), planOf([scored(a)]));
    expect(r.skipped).toEqual([{ id: a.id, reason: "parse-failed" }]);
    expect(r.workspace.files.get("f.md")).toBe(bad);
  });

  it("refuses protected engrams (INV-1)", () => {
    const a = nodes("f.md", TEXT)[0]!;
    const r = run(ws({ "f.md": TEXT }), planOf([scored(a, true)]));
    expect(r.skipped).toEqual([{ id: a.id, reason: "protected" }]);
    expect(r.workspace.files.get("f.md")).toBe(TEXT);
    expect(r.tombstones).toEqual([]);
  });

  it("buries a repeated id once and reports duplicate-entry", () => {
    const [a, b] = nodes("f.md", TEXT);
    const r = run(ws({ "f.md": TEXT }), planOf([scored(a!)], [{ keep: scored(b!), drop: scored(a!) }]));
    expect(r.tombstones).toHaveLength(1);
    expect(r.skipped).toEqual([{ id: a!.id, reason: "duplicate-entry" }]);
  });

  it("empty plan returns a deep-equal workspace", () => {
    const w = ws({ "f.md": TEXT });
    const r = run(w, planOf([]));
    expect(r.workspace).toEqual(w);
    expect(r.tombstones).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it("does not mutate frozen inputs and is deterministic", () => {
    const [a, b] = nodes("f.md", TEXT);
    const old = toTombstone(scored(a!), "decayed", 1, NOW, 0, "raw");
    const w = Object.freeze(ws({ "f.md": TEXT }, Object.freeze([old])));
    const p = Object.freeze(planOf([scored(b!)]));
    const r1 = run(w, p);
    const r2 = run(w, p);
    expect(r1).toEqual(r2);
    expect(w.files.get("f.md")).toBe(TEXT);
    expect(r1.workspace.files).not.toBe(w.files);
    expect(r1.workspace.tombstones).toHaveLength(2);
    expect(r1.workspace.tombstones).toContainEqual(old);
  });
});

describe("applyPlan nothing-lost loop", () => {
  it("kept text + removed raws reassemble to the original (LCG, 100 workspaces)", () => {
    let seed = 12345;
    const next = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    for (let i = 0; i < 100; i++) {
      const eol = next(2) === 0 ? "\n" : "\r\n";
      const count = 1 + next(6);
      let text = next(2) === 0 ? `---${eol}k: v${eol}---${eol}` : "";
      text += `intro${eol}`;
      for (let k = 0; k < count; k++) text += `## S${k}${eol}body ${next(1000)}${eol}${eol}`;
      const old = toTombstone(scored(nodes("z.md", "## Z\nz\n")[0]!), "decayed", 0, NOW, 0, "## Z\nz\n");
      const ns = nodes("f.md", text);
      const chosen = ns.filter(() => next(2) === 0);
      const r = run(ws({ "f.md": text }, [old]), planOf(chosen.map((n) => scored(n))));
      expect(r.skipped).toEqual([]);
      expect(r.workspace.tombstones).toContainEqual(old);
      // Reassemble: walk original spans in order, taking kept text or the tombstone raw.
      const rawById = new Map(r.tombstones.map((t) => [t.id, t.raw]));
      const kept = r.workspace.files.get("f.md") ?? "";
      let cursor = 0;
      let rebuilt = "";
      let pos = 0;
      for (const n of ns) {
        const raw = rawById.get(n.id);
        if (raw === undefined) continue;
        const gap = n.span.start - pos;
        rebuilt += kept.slice(cursor, cursor + gap) + raw;
        cursor += gap;
        pos = n.span.end;
      }
      rebuilt += kept.slice(cursor);
      expect(rebuilt).toBe(text);
    }
  });
});
