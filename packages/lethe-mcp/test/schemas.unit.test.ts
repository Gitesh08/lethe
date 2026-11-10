import { describe, expect, it } from "vitest";
import {
  ConsolidateSleepInput,
  DetectContradictionsInput,
  ResurrectEngramInput,
  ScoreMemoriesInput,
} from "../src/tools/schemas.js";
import { parseInput } from "../src/envelope/zod-error.js";

const WS = process.platform === "win32" ? "C:\\work\\repo" : "/work/repo";

const SCHEMAS = [
  ["score_memories", ScoreMemoriesInput, {}],
  ["detect_contradictions", DetectContradictionsInput, {}],
  ["consolidate_sleep", ConsolidateSleepInput, {}],
  ["resurrect_engram", ResurrectEngramInput, { query: "x" }],
] as const;

describe("tool input schemas", () => {
  it.each(SCHEMAS)("%s accepts a minimal valid input", (_n, schema, extra) => {
    expect(schema.safeParse({ workspacePath: WS, ...extra }).success).toBe(true);
  });

  it.each(SCHEMAS)("%s rejects unknown properties", (_n, schema, extra) => {
    const r = parseInput(schema, { workspacePath: WS, ...extra, bogus: 1 });
    expect(r.ok).toBe(false);
  });

  it.each(SCHEMAS)("%s rejects relative and empty workspacePath", (_n, schema, extra) => {
    for (const p of ["rel/dir", "./x", "", "..\\x"]) {
      expect(schema.safeParse({ workspacePath: p, ...extra }).success).toBe(false);
    }
  });

  it("accepts both windows and posix absolute paths", () => {
    for (const p of ["C:\\a\\b", "/a/b"]) {
      expect(ScoreMemoriesInput.safeParse({ workspacePath: p }).success).toBe(true);
    }
  });

  it("rejects NUL in workspacePath", () => {
    expect(ScoreMemoriesInput.safeParse({ workspacePath: "/a\0b" }).success).toBe(false);
  });

  it("enforces gateRuns bounds 1..10000", () => {
    const parse = (gateRuns: number) => ConsolidateSleepInput.safeParse({ workspacePath: WS, gateRuns });
    expect(parse(0).success).toBe(false);
    expect(parse(1).success).toBe(true);
    expect(parse(10000).success).toBe(true);
    expect(parse(10001).success).toBe(false);
    expect(parse(1.5).success).toBe(false);
  });

  it("enforces query length 1..500", () => {
    const parse = (query: string) => ResurrectEngramInput.safeParse({ workspacePath: WS, query });
    expect(parse("").success).toBe(false);
    expect(parse("a").success).toBe(true);
    expect(parse("a".repeat(500)).success).toBe(true);
    expect(parse("a".repeat(501)).success).toBe(false);
  });

  it("accepts skipGate together with apply (operation rejects later)", () => {
    const r = ConsolidateSleepInput.safeParse({ workspacePath: WS, skipGate: true, apply: true });
    expect(r.success).toBe(true);
  });

  it("applies defaults", () => {
    const r = ConsolidateSleepInput.parse({ workspacePath: WS });
    expect(r).toMatchObject({ apply: false, skipGate: false, gateRuns: 100 });
    expect(ResurrectEngramInput.parse({ workspacePath: WS, query: "q" }).apply).toBe(false);
  });

  it("validates now and atCommit", () => {
    expect(ScoreMemoriesInput.safeParse({ workspacePath: WS, now: "2026-11-09T00:00:00Z" }).success).toBe(true);
    expect(ScoreMemoriesInput.safeParse({ workspacePath: WS, now: "yesterday" }).success).toBe(false);
    expect(ScoreMemoriesInput.safeParse({ workspacePath: WS, atCommit: -1 }).success).toBe(false);
    expect(ScoreMemoriesInput.safeParse({ workspacePath: WS, atCommit: 1.5 }).success).toBe(false);
  });

  it("reports INVALID_INPUT with path and message only", () => {
    const r = parseInput(ConsolidateSleepInput, { workspacePath: "rel", gateRuns: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("INVALID_INPUT");
    const detail = r.error.detail as ReadonlyArray<Record<string, unknown>>;
    expect(detail.map((d) => d["path"])).toEqual(["workspacePath", "gateRuns"]);
    for (const d of detail) expect(Object.keys(d).sort()).toEqual(["message", "path"]);
  });
});
