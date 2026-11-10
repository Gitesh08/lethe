import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  TOOL_ERROR_CODES,
  fromUnknown,
  isToolErrorCode,
  mapCoreError,
  sanitizeDetail,
  toolError,
} from "../src/envelope/errors.js";
import { SUMMARY_MAX_CHARS, envelopeText, fail, normaliseSummary, ok } from "../src/envelope/envelope.js";
import { formatIssuePath, fromZodError } from "../src/envelope/zod-error.js";

const STACK_RE = /\n\s+at\s|\.ts:\d+|\.js:\d+/;

describe("errors", () => {
  it("toolError omits undefined detail", () => {
    expect("detail" in toolError("LOCKED", "m")).toBe(false);
    expect(toolError("LOCKED", "m", 0)).toEqual({ code: "LOCKED", message: "m", detail: 0 });
  });

  it("recognises every code and nothing else", () => {
    for (const c of TOOL_ERROR_CODES) expect(isToolErrorCode(c)).toBe(true);
    expect(isToolErrorCode("NOPE")).toBe(false);
    expect(isToolErrorCode(3)).toBe(false);
    expect(new Set(TOOL_ERROR_CODES).size).toBe(TOOL_ERROR_CODES.length);
  });

  it("sanitizeDetail strips stack keys and Error instances recursively, sorting keys", () => {
    const out = sanitizeDetail({ z: 1, stack: "at x", a: { stack: "s", e: new Error("boom"), k: [new Error("q"), 2] } });
    expect(out).toEqual({ a: { k: [2] }, z: 1 });
    expect(Object.keys(out as object)).toEqual(["a", "z"]);
    expect(sanitizeDetail(new Error("x"))).toBeUndefined();
  });

  it("mapCoreError keeps code/message and leaves no stack text", () => {
    const e = new Error("inner");
    const mapped = mapCoreError({
      code: "PATH_ESCAPE",
      message: "escape",
      detail: { path: "a", stack: e.stack, cause: e },
    });
    expect(mapped.code).toBe("PATH_ESCAPE");
    expect(JSON.stringify(mapped)).not.toMatch(STACK_RE);
    expect(JSON.stringify(mapped)).not.toContain("inner");
    expect("detail" in mapCoreError({ code: "CONFIG_INVALID", message: "m" })).toBe(false);
  });

  it("fromUnknown returns a generic INTERNAL_ERROR for any thrown value", () => {
    const hostile = { toString: () => { throw new Error("nope"); } };
    const values: unknown[] = [new Error("secret"), "str", 42, null, undefined, { a: 1 }, Symbol("s"), hostile];
    for (const v of values) {
      const t = fromUnknown(v);
      expect(t).toEqual({ code: "INTERNAL_ERROR", message: "An internal error occurred." });
      expect(JSON.stringify(t)).not.toMatch(STACK_RE);
    }
  });

  it("fromUnknown logs the full description only to the log callback", () => {
    const logs: string[] = [];
    const err = new Error("secret");
    fromUnknown(err, (m) => logs.push(m));
    fromUnknown("plain", (m) => logs.push(m));
    fromUnknown(undefined, (m) => logs.push(m));
    expect(logs[0]).toContain("secret");
    expect(logs[1]).toBe("plain");
    expect(logs[2]).toBe("undefined");
  });

  it("fromUnknown survives an unprintable value when logging", () => {
    const logs: string[] = [];
    const hostile = { toString: () => { throw new Error("nope"); } };
    fromUnknown(hostile, (m) => logs.push(m));
    expect(logs).toEqual(["unprintable error"]);
  });
});

describe("zod error mapping", () => {
  it("formats paths", () => {
    expect(formatIssuePath([])).toBe("(root)");
    expect(formatIssuePath(["items", 0, "id"])).toBe("items.0.id");
  });

  it("maps issues to INVALID_INPUT without stack text", () => {
    const r = z.object({ a: z.string(), b: z.number() }).strict().safeParse({ a: 1, c: 2 });
    expect(r.success).toBe(false);
    if (r.success) return;
    const t = fromZodError(r.error);
    expect(t.code).toBe("INVALID_INPUT");
    expect(t.message).toMatch(/^invalid input \(\d+ issues\)$/);
    expect(JSON.stringify(t)).not.toMatch(STACK_RE);
  });

  it("uses singular message for one issue and (root) path", () => {
    const r = z.string().safeParse(1);
    if (r.success) throw new Error("expected failure");
    const t = fromZodError(r.error);
    expect(t.message).toBe("invalid input");
    expect((t.detail as ReadonlyArray<{ path: string }>)[0]?.path).toBe("(root)");
  });
});

describe("envelope", () => {
  it("ok and fail build the documented shapes", () => {
    expect(ok("done", { n: 1 })).toEqual({ ok: true, summary: "done", data: { n: 1 } });
    const e = toolError("LOCKED", "busy");
    expect(fail(e)).toEqual({ ok: false, summary: "LOCKED: busy", error: e });
    expect(fail(e, "custom").summary).toBe("custom");
  });

  it("normaliseSummary collapses whitespace, truncates by code point, is idempotent", () => {
    expect(normaliseSummary("  a \n\t b\u2028c\u0085d  ")).toBe("a b c d");
    const long = "😀".repeat(SUMMARY_MAX_CHARS + 50);
    const cut = normaliseSummary(long);
    expect(Array.from(cut)).toHaveLength(SUMMARY_MAX_CHARS);
    expect(cut.endsWith("\u2026")).toBe(true);
    expect(normaliseSummary(cut)).toBe(cut);
    const exact = "x".repeat(SUMMARY_MAX_CHARS);
    expect(normaliseSummary(exact)).toBe(exact);
  });

  it("envelopeText is plain JSON of the envelope", () => {
    const env = ok("s", { a: 1 });
    expect(JSON.parse(envelopeText(env))).toEqual(env);
  });
});
