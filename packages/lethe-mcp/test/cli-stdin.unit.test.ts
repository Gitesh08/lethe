// Bounded stdin reader (Req 19 probe): cap, timeout, closed/TTY stdin. Real streams, no mocks.
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { readLimited } from "../src/cli/stdin.js";

describe("readLimited", () => {
  it("returns everything at EOF", async () => {
    const s = new PassThrough();
    const p = readLimited(s, { maxBytes: 100, timeoutMs: 1000 });
    s.write("hello ");
    s.end("world");
    expect(await p).toBe("hello world");
  });

  it("stops at the byte cap", async () => {
    const s = new PassThrough();
    const p = readLimited(s, { maxBytes: 4, timeoutMs: 1000 });
    s.write("abcdefgh");
    expect(await p).toBe("abcd");
  });

  it("resolves with partial data at the time limit when the stream stays open", async () => {
    const s = new PassThrough();
    const p = readLimited(s, { maxBytes: 100, timeoutMs: 30 });
    s.write("partial");
    expect(await p).toBe("partial");
  });

  it("resolves empty for an already-ended stream", async () => {
    const s = new PassThrough();
    s.end();
    expect(await readLimited(s, { maxBytes: 10, timeoutMs: 1000 })).toBe("");
  });

  it("resolves empty for a TTY without reading", async () => {
    const s = Object.assign(new PassThrough(), { isTTY: true });
    expect(await readLimited(s, { maxBytes: 10, timeoutMs: 1000 })).toBe("");
  });

  it("resolves with what was read on stream error", async () => {
    const s = new PassThrough();
    const p = readLimited(s, { maxBytes: 100, timeoutMs: 1000 });
    s.write("x");
    await new Promise((r) => setImmediate(r));
    s.destroy(new Error("boom"));
    expect(await p).toBe("x");
  });
});
