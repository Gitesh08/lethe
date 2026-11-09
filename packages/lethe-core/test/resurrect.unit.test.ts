// Unit tests for resurrect (and the archive -> resurrect round trip).
// Refs: REQ-CRY-3, REQ-CRY-7, INV-3
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { applyPlan } from "../src/crypt/apply.js";
import { resurrect } from "../src/crypt/resurrect.js";
import { score } from "../src/decay/score.js";
import { parseDocument } from "../src/parse/document.js";
import type {
  ConsolidationPlan, EngramNode, LetheConfig, ScoredEngram, TombstoneRecord, VirtualWorkspace,
} from "../src/types.js";

const NOW = "2026-03-01T00:00:00.000Z";
const LATER = "2026-04-01T00:00:00.000Z";
const cfg = DEFAULT_CONFIG;

function nodes(file: string, text: string, c: LetheConfig = cfg): readonly EngramNode[] {
  const r = parseDocument(file, text, c);
  if (!r.ok) throw new Error("parse failed in test");
  return r.value.engrams;
}

function scored(node: EngramNode): ScoredEngram {
  return {
    node,
    state: { id: node.id, stability: 5, lastReinforcedCommit: 1, lastReinforcedAt: NOW, reinforcements: 0 },
    deltaC: 10, weight: 1, retention: 0.1, rawRetention: 0.1,
    tier: "crypt", status: "active", protected: false,
  };
}

function planOf(ns: readonly EngramNode[]): ConsolidationPlan {
  return {
    toArchive: ns.map((n) => ({ engram: scored(n), reason: "decayed" as const })),
    toMerge: [], toDemote: [], budgetStatus: "ok", tokensBefore: 0, tokensAfter: 0,
  };
}

const ws = (files: Record<string, string>, tombstones: readonly TombstoneRecord[] = []): VirtualWorkspace =>
  ({ files: new Map(Object.entries(files)), tombstones });

/** Archive the engrams at `idx` of `text`; returns the resulting workspace and records (by index order). */
function bury(text: string, idx: readonly number[], c: LetheConfig = cfg, extra: readonly TombstoneRecord[] = []) {
  const ns = nodes("f.md", text, c);
  const chosen = idx.map((i) => ns[i]).filter((n): n is EngramNode => n !== undefined);
  const r = applyPlan(ws({ "f.md": text }, extra), planOf(chosen), 7, NOW, c);
  expect(r.skipped).toEqual([]);
  const tombs = idx.map((i) => r.tombstones.find((t) => t.id === ns[i]?.id) as TombstoneRecord);
  return { work: r.workspace, tombs, ns };
}

function revive(w: VirtualWorkspace, t: TombstoneRecord, c: LetheConfig = cfg) {
  const r = resurrect(w, t, 20, LATER, c);
  if (!r.ok) throw new Error(`resurrect failed: ${r.error.code} ${r.error.message}`);
  return r.value;
}

const TEXT = "# T\n\n## A\nalpha\n\n## B\nbeta\n\n## C\ngamma\n";
const NO_EOL = "# T\n\n## A\nalpha\n\n## B\nbeta\n\n## C\ngamma";
const CRLF = "---\r\ninclusion: always\r\n---\r\n## A\r\nalpha\r\n## B\r\nbeta\r\n## C\r\ngamma\r\n";
const FM = "---\ninclusion: always\n---\nintro\n## A\nalpha\n\n## B\nbeta\n\n## C\ngamma\n";

describe("resurrect byte-exact round trip", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["plain", TEXT], ["no trailing newline", NO_EOL], ["CRLF + frontmatter", CRLF], ["frontmatter", FM],
  ];
  for (const [name, text] of cases) {
    for (const [label, i] of [["first", 0], ["middle", 1], ["last", 2]] as const) {
      it(`${name}: ${label} engram`, () => {
        const { work, tombs, ns } = bury(text, [i]);
        const t = tombs[0] as TombstoneRecord;
        expect(work.files.get("f.md")).not.toBe(text);
        const out = revive(work, t);
        expect(out.workspace.files.get("f.md")).toBe(text);
        expect(out.workspace.tombstones).toEqual([]);
        expect(out.placement).toBe(i === 0 ? "index" : "neighbor");
        const back = nodes("f.md", out.workspace.files.get("f.md") ?? "").find((n) => n.id === t.id);
        expect(back).toEqual(ns[i]);
      });
    }
  }

  it("bullet granularity (last bullet; ids are positional)", () => {
    const bc: LetheConfig = { ...cfg, granularity: "bullet" };
    const text = "intro\n- one <!-- lethe: pin=true -->\n- two\n  sub\n- three\n";
    const { work, tombs, ns } = bury(text, [2], bc);
    const out = revive(work, tombs[0] as TombstoneRecord, bc);
    expect(out.workspace.files.get("f.md")).toBe(text);
    const back = nodes("f.md", text, bc)[2];
    expect(back).toEqual(ns[2]);
  });

  it("bullet granularity: positional id collision is reported, never duplicated", () => {
    const bc: LetheConfig = { ...cfg, granularity: "bullet" };
    const text = "- one\n- two\n- three\n";
    const { work, tombs } = bury(text, [0], bc);
    const r = resurrect(work, tombs[0] as TombstoneRecord, 20, LATER, bc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("PARSE_DUPLICATE_ID");
  });

  it("keeps all node fields incl. annotations", () => {
    const text = "## A\nalpha\n\n## B\n<!-- lethe: pin=true globs=src/** spec=lethe-core -->\nbeta\n\n## C\ngamma\n";
    const { work, tombs, ns } = bury(text, [1]);
    const t = tombs[0] as TombstoneRecord;
    const out = revive(work, t);
    const back = nodes("f.md", out.workspace.files.get("f.md") ?? "")[1];
    expect(back).toEqual(ns[1]);
  });
});

describe("resurrect bookkeeping", () => {
  it("removes exactly the matching record and keeps others", () => {
    const old = bury("## Z\nz\n\n## Y\ny\n", [0]).tombs[0] as TombstoneRecord;
    const { work, tombs } = bury(TEXT, [1], cfg, [old]);
    const t = tombs[0] as TombstoneRecord;
    const out = revive(work, t);
    expect(out.workspace.tombstones).toEqual([old]);
  });

  it("keeps another record that has the same id", () => {
    const { work, tombs } = bury(TEXT, [1]);
    const t = tombs[0] as TombstoneRecord;
    const twin: TombstoneRecord = { ...t, buriedAtCommit: 3 };
    const w = { ...work, tombstones: [twin, t] };
    const out = revive(w, t);
    expect(out.workspace.tombstones).toEqual([twin]);
  });

  it("TOMBSTONE_NOT_FOUND for unknown and for already-resurrected records", () => {
    const { work, tombs } = bury(TEXT, [1]);
    const t = tombs[0] as TombstoneRecord;
    const unknown = resurrect(work, { ...t, buriedAt: "x" }, 20, LATER, cfg);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.error.code).toBe("TOMBSTONE_NOT_FOUND");
      expect(unknown.error.message).toContain(t.id);
    }
    const out = revive(work, t);
    const again = resurrect(out.workspace, t, 21, LATER, cfg);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("TOMBSTONE_NOT_FOUND");
  });

  it("schema 2 => CONFIG_INVALID", () => {
    const { work, tombs } = bury(TEXT, [1]);
    const bad = { ...(tombs[0] as TombstoneRecord), schema: 2 } as unknown as TombstoneRecord;
    const r = resurrect({ ...work, tombstones: [bad] }, bad, 20, LATER, cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("CONFIG_INVALID");
  });

  it("resets state and scores as hot with retention exactly 1", () => {
    const { work, tombs } = bury(TEXT, [1]);
    const t = tombs[0] as TombstoneRecord;
    const out = revive(work, t);
    expect(out.state).toEqual({
      id: t.id, stability: cfg.s0, lastReinforcedCommit: 20, lastReinforcedAt: LATER, reinforcements: 0,
    });
    const node = nodes("f.md", out.workspace.files.get("f.md") ?? "").find((n) => n.id === t.id) as EngramNode;
    const [s] = score({
      engrams: [node], states: [out.state], specs: [], ledger: [], nowCommit: 20, nowISO: LATER, cfg,
    });
    expect(s?.retention).toBe(1);
    expect(s?.tier).toBe("hot");
  });
});

describe("resurrect placement", () => {
  it("follows the neighbor after it moved", () => {
    const { work, tombs } = bury(TEXT, [2]);
    const cur = work.files.get("f.md") ?? "";
    const edited = cur.replace("# T\n\n", "# T\n\n## N\nnew\n\n");
    const out = revive({ ...work, files: new Map([["f.md", edited]]) }, tombs[0] as TombstoneRecord);
    expect(out.placement).toBe("neighbor");
    expect(out.workspace.files.get("f.md")).toBe(edited + "## C\ngamma\n");
  });

  it("neighbor gone + index in range => index placement", () => {
    const { work, tombs } = bury(TEXT, [1]);
    const edited = (work.files.get("f.md") ?? "").replace("## A\nalpha\n\n", "## Q\nq\n\n");
    const out = revive({ ...work, files: new Map([["f.md", edited]]) }, tombs[0] as TombstoneRecord);
    expect(out.placement).toBe("index");
    expect(out.workspace.files.get("f.md")).toBe("# T\n\n## Q\nq\n\n## B\nbeta\n\n## C\ngamma\n");
  });

  it("index out of range => fallback ## Resurrected", () => {
    const { work, tombs } = bury(TEXT, [2]);
    const small = "# T\n\n## A\nalpha\n";
    const out = revive({ ...work, files: new Map([["f.md", small]]) }, tombs[0] as TombstoneRecord);
    expect(out.placement).toBe("fallback");
    expect(out.workspace.files.get("f.md")).toBe(small + "\n## Resurrected\n## C\ngamma\n");
  });

  it("fallback uses CRLF and adds a missing final newline", () => {
    const { work, tombs } = bury(CRLF, [2]);
    const small = "## A\r\nalpha";
    const out = revive({ ...work, files: new Map([["f.md", small]]) }, tombs[0] as TombstoneRecord);
    expect(out.workspace.files.get("f.md")).toBe(`${small}\r\n\r\n## Resurrected\r\n## C\r\ngamma\r\n`);
  });

  it("second fallback reuses the existing Resurrected section", () => {
    const { work, tombs } = bury(TEXT, [1, 2]);
    const far = (t: TombstoneRecord): TombstoneRecord => ({ ...t, position: { index: 50, neighborBefore: "nope" } });
    const [b, c] = [far(tombs[0] as TombstoneRecord), far(tombs[1] as TombstoneRecord)];
    const w = { ...work, tombstones: [b, c] };
    const first = revive(w, c);
    expect(first.placement).toBe("fallback");
    const second = revive(first.workspace, b);
    expect(second.placement).toBe("fallback");
    const text = second.workspace.files.get("f.md") ?? "";
    expect(text.split("## Resurrected").length - 1).toBe(1);
    expect(text).toContain((b as TombstoneRecord).raw);
    expect(text).toContain((c as TombstoneRecord).raw);
  });

  it("missing file => new-file containing exactly raw", () => {
    const { work, tombs } = bury(TEXT, [1]);
    const t = tombs[0] as TombstoneRecord;
    const out = revive({ ...work, files: new Map() }, t);
    expect(out.placement).toBe("new-file");
    expect(out.workspace.files.get("f.md")).toBe(t.raw);
  });

  it("existing same-id engram => PARSE_DUPLICATE_ID", () => {
    const { tombs } = bury(TEXT, [1]);
    const r = resurrect(ws({ "f.md": TEXT }, tombs), tombs[0] as TombstoneRecord, 20, LATER, cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("PARSE_DUPLICATE_ID");
      expect(r.error.message).toContain("resolve manually");
    }
  });

  it("unparsable file => propagated parse error", () => {
    const { work, tombs } = bury(TEXT, [1]);
    const bad = "---\nfoo: bar\n## A\nalpha\n";
    const r = resurrect({ ...work, files: new Map([["f.md", bad]]) }, tombs[0] as TombstoneRecord, 20, LATER, cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("PARSE_INVALID_FRONTMATTER");
  });
});

describe("resurrect multi-archive orders", () => {
  const orders: ReadonlyArray<readonly number[]> = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ];
  for (const order of orders) {
    it(`order ${order.join(",")}: all engrams back, no duplicate ids`, () => {
      const { work, tombs, ns } = bury(TEXT, [0, 1, 2]);
      let w = work;
      for (const i of order) w = revive(w, tombs[i] as TombstoneRecord).workspace;
      const text = w.files.get("f.md") ?? "";
      const back = nodes("f.md", text); // parse fails on duplicate ids
      for (const n of ns) {
        const found = back.find((b) => b.id === n.id);
        expect(found?.body).toBe(n.body);
        expect(found?.contentHash).toBe(n.contentHash);
        expect(text).toContain((tombs.find((t) => t?.id === n.id) as TombstoneRecord).raw);
      }
      expect(w.tombstones).toEqual([]);
      if (order.join(",") === "0,1,2") expect(text).toBe(TEXT);
    });
  }
});

describe("resurrect purity", () => {
  it("does not mutate frozen inputs and is deterministic", () => {
    const { work, tombs } = bury(TEXT, [1]);
    const t = Object.freeze(tombs[0] as TombstoneRecord);
    const w: VirtualWorkspace = Object.freeze({
      files: work.files, tombstones: Object.freeze([...work.tombstones]),
    });
    const before = w.files.get("f.md");
    const r1 = resurrect(w, t, 20, LATER, cfg);
    const r2 = resurrect(w, t, 20, LATER, cfg);
    expect(r1).toEqual(r2);
    expect(w.files.get("f.md")).toBe(before);
    expect(w.tombstones).toHaveLength(1);
    if (r1.ok) expect(r1.value.workspace.files).not.toBe(w.files);
  });
});
