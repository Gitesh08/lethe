// Unit tests for toTombstone + tombstones.json (de)serialization.
// Refs: REQ-CRY-1, REQ-CRY-3, INV-3
import { describe, expect, it } from "vitest";
import { toTombstone } from "../src/crypt/archive.js";
import { KEY_ORDER, parseTombstones, serializeTombstones } from "../src/crypt/tombstone-json.js";
import type { ScoredEngram, TombstoneRecord } from "../src/types.js";

const BODY = "Line one\r\nZ\u200Bero-width \u00e9 \u{1F480}\r\n";
const RAW = `## Heading\r\n${BODY}`;

function mk(id = "f.md#a", body = BODY): ScoredEngram {
  return {
    node: {
      id, file: "f.md", headingPath: ["Top", "A"], body, contentHash: "h1", tokens: 7,
      globs: ["**/*.ts"], specLinks: ["REQ-1"], pinned: false, span: { start: 0, end: 10 },
    },
    state: { id, stability: 5.5, lastReinforcedCommit: 3, lastReinforcedAt: "2026-01-01T00:00:00.000Z", reinforcements: 2 },
    deltaC: 9, weight: 1, retention: 0.123, rawRetention: 0.123,
    tier: "crypt", status: "active", protected: false,
  };
}

const bury = (id: string, commit: number, extra?: { nb?: string; by?: string }): TombstoneRecord =>
  toTombstone(mk(id), "decayed", commit, "2026-02-01T00:00:00.000Z", 1, RAW, extra?.nb, extra?.by);

describe("toTombstone", () => {
  it("copies fields byte-exact and preserves raw", () => {
    const t = toTombstone(mk(), "contradiction", 42, "2026-02-01T00:00:00.000Z", 3, RAW, "f.md#prev", "f.md#win");
    expect(t.schema).toBe(1);
    expect(t.body).toBe(BODY);
    expect(t.raw).toBe(RAW);
    expect(t).toMatchObject({
      id: "f.md#a", file: "f.md", headingPath: ["Top", "A"], contentHash: "h1", tokens: 7,
      meta: { globs: ["**/*.ts"], specLinks: ["REQ-1"], pinned: false },
      reason: "contradiction", retentionAtDeath: 0.123, buriedAtCommit: 42,
      buriedAt: "2026-02-01T00:00:00.000Z", defeatedBy: "f.md#win",
      position: { index: 3, neighborBefore: "f.md#prev" },
    });
    expect(t.state).toEqual(mk().state);
  });

  it("omits optional keys when undefined", () => {
    const t = bury("f.md#a", 1);
    expect(Object.keys(t)).not.toContain("defeatedBy");
    expect(Object.keys(t.position)).toEqual(["index"]);
  });

  it("copies arrays so the record does not alias input", () => {
    const s = mk();
    const t = toTombstone(s, "decayed", 1, "x", 0, RAW);
    expect(t.headingPath).not.toBe(s.node.headingPath);
    expect(t.meta.globs).not.toBe(s.node.globs);
    expect(t.meta.specLinks).not.toBe(s.node.specLinks);
    expect(t.state).not.toBe(s.state);
  });

  it("does not mutate a frozen input", () => {
    const s = mk();
    Object.freeze(s.node.headingPath); Object.freeze(s.node.globs); Object.freeze(s.node.specLinks);
    Object.freeze(s.node); Object.freeze(s.state); Object.freeze(s);
    expect(() => toTombstone(s, "duplicate", 1, "x", 0, RAW)).not.toThrow();
  });
});

describe("serializeTombstones / parseTombstones", () => {
  const list = [bury("b", 5), bury("a", 5, { nb: "z", by: "w" }), bury("c", 2)];

  it("is deterministic and order-independent, sorted by (commit, id)", () => {
    const text = serializeTombstones(list);
    expect(serializeTombstones(list)).toBe(text);
    expect(serializeTombstones([list[2]!, list[0]!, list[1]!])).toBe(text);
    const parsed = parseTombstones(text);
    expect(parsed.ok && parsed.value.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("uses 2-space indent, trailing newline and stable key order", () => {
    const text = serializeTombstones(list);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.startsWith('{\n  "version": 1,\n  "tombstones": [\n    {\n      "schema": 1,')).toBe(true);
    const root = JSON.parse(text) as { tombstones: Array<Record<string, unknown>> };
    const withBy = root.tombstones.find((t) => t["id"] === "a");
    expect(Object.keys(withBy ?? {})).toEqual([...KEY_ORDER]);
    const without = root.tombstones.find((t) => t["id"] === "b");
    expect(Object.keys(without ?? {})).toEqual(KEY_ORDER.filter((k) => k !== "defeatedBy"));
  });

  it("round-trips byte-exact bodies and raw", () => {
    const r = parseTombstones(serializeTombstones(list));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sorted = [list[2]!, list[1]!, list[0]!];
    expect(r.value).toEqual(sorted);
    expect(r.value.every((t) => t.raw === RAW && t.body === BODY)).toBe(true);
    expect(serializeTombstones(r.value)).toBe(serializeTombstones(list));
  });

  it("round-trips an empty list", () => {
    const r = parseTombstones(serializeTombstones([]));
    expect(r).toEqual({ ok: true, value: [] });
  });

  const good = (): Record<string, unknown> => JSON.parse(serializeTombstones([bury("a", 1)])).tombstones[0];
  const wrap = (t: unknown, version: unknown = 1): string => JSON.stringify({ version, tombstones: [t] });

  it.each<[string, () => string]>([
    ["invalid JSON", () => "{nope"],
    ["non-object root", () => "[]"],
    ["wrong version", () => JSON.stringify({ version: 2, tombstones: [] })],
    ["non-array tombstones", () => JSON.stringify({ version: 1, tombstones: {} })],
    ["schema 2", () => wrap({ ...good(), schema: 2 })],
    ["missing raw", () => wrap({ ...good(), raw: undefined })],
    ["wrong type tokens", () => wrap({ ...good(), tokens: "7" })],
    ["wrong type meta", () => wrap({ ...good(), meta: { globs: "x", specLinks: [], pinned: false } })],
    ["bad reason", () => wrap({ ...good(), reason: "nope" })],
    ["non-object entry", () => wrap(5)],
  ])("rejects %s without throwing", (_name, make) => {
    const r = parseTombstones(make());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("CONFIG_INVALID");
  });
});
