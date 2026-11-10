// Atomic writer failure injection and byte-exactness. Refs: Req 8.1, 8.2, NFR-3
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWrite, type AtomicFsOps, type AtomicWriteOptions } from "../src/io/atomic-write.js";
import { nodeAtomicFsOps } from "../src/io/workspace-fs.js";

let root = "";
let target = "";
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-aw-")));
  target = join(root, "f.md");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function fail(code: string): Error {
  return Object.assign(new Error(`injected ${code}`), { code });
}

function wrap(over: Partial<AtomicFsOps>): AtomicFsOps {
  return { ...nodeAtomicFsOps, ...over };
}

const opts: AtomicWriteOptions = { renameBackoffMs: [0, 0, 0], platform: "win32" };

function expectIoFailed(r: Awaited<ReturnType<typeof atomicWrite>>, code: string): void {
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error.code).toBe("IO_FAILED");
  expect(r.error.detail).toMatchObject({ code });
}

describe("atomicWrite failure injection", () => {
  const stages: ReadonlyArray<[string, string, Partial<AtomicFsOps>]> = [
    ["write", "ENOSPC", {
      openExclusive: async (p) => {
        const h = await nodeAtomicFsOps.openExclusive(p);
        return { ...h, write: async () => { throw fail("ENOSPC"); } };
      },
    }],
    ["fsync", "EIO", {
      openExclusive: async (p) => {
        const h = await nodeAtomicFsOps.openExclusive(p);
        return { ...h, sync: async () => { throw fail("EIO"); } };
      },
    }],
    ["rename", "EXDEV", { rename: async () => { throw fail("EXDEV"); } }],
  ];

  for (const [stage, code, over] of stages) {
    it(`${stage} failure keeps existing target unchanged and leaves no temp file`, async () => {
      writeFileSync(target, "original\r\n");
      const r = await atomicWrite(wrap(over), target, "new content", opts);
      expectIoFailed(r, code);
      expect(readFileSync(target, "utf8")).toBe("original\r\n");
      expect(readdirSync(root)).toEqual(["f.md"]);
    });

    it(`${stage} failure keeps an absent target absent`, async () => {
      const r = await atomicWrite(wrap(over), target, "new content", opts);
      expectIoFailed(r, code);
      expect(readdirSync(root)).toEqual([]);
    });
  }

  it("mkdirp failure returns IO_FAILED without touching anything", async () => {
    const r = await atomicWrite(wrap({ mkdirp: async () => { throw fail("EACCES"); } }), target, "x", opts);
    expectIoFailed(r, "EACCES");
    expect(readdirSync(root)).toEqual([]);
  });

  it("errors without a code report UNKNOWN", async () => {
    const r = await atomicWrite(wrap({ rename: async () => { throw new Error("boom"); } }), target, "x", opts);
    expectIoFailed(r, "UNKNOWN");
  });

  it("swallows an unlink failure during cleanup and still reports the original error", async () => {
    const ops = wrap({
      rename: async () => { throw fail("EXDEV"); },
      unlink: async () => { throw fail("EPERM"); },
    });
    const r = await atomicWrite(ops, target, "x", opts);
    expectIoFailed(r, "EXDEV");
  });
});

describe("atomicWrite rename retry", () => {
  it("retries a transient EPERM/EBUSY and then succeeds", async () => {
    writeFileSync(target, "old");
    const delays: number[] = [];
    let calls = 0;
    const ops = wrap({
      rename: async (a, b) => {
        calls += 1;
        if (calls === 1) throw fail("EPERM");
        if (calls === 2) throw fail("EBUSY");
        await nodeAtomicFsOps.rename(a, b);
      },
      delay: async (ms) => { delays.push(ms); },
    });
    const r = await atomicWrite(ops, target, "new", { renameBackoffMs: [3, 5, 7], platform: "win32" });
    expect(r.ok).toBe(true);
    expect(calls).toBe(3);
    expect(delays).toEqual([3, 5]);
    expect(readFileSync(target, "utf8")).toBe("new");
    expect(readdirSync(root)).toEqual(["f.md"]);
  });

  it("returns IO_FAILED once retries are exhausted and cleans up", async () => {
    writeFileSync(target, "old");
    const delays: number[] = [];
    let calls = 0;
    const ops = wrap({
      rename: async () => { calls += 1; throw fail("EBUSY"); },
      delay: async (ms) => { delays.push(ms); },
    });
    const r = await atomicWrite(ops, target, "new", opts);
    expectIoFailed(r, "EBUSY");
    expect(calls).toBe(4);
    expect(delays).toEqual([0, 0, 0]);
    expect(readFileSync(target, "utf8")).toBe("old");
    expect(readdirSync(root)).toEqual(["f.md"]);
  });

  it("does not retry a non-retryable code", async () => {
    const delays: number[] = [];
    let calls = 0;
    const ops = wrap({
      rename: async () => { calls += 1; throw fail("EXDEV"); },
      delay: async (ms) => { delays.push(ms); },
    });
    const r = await atomicWrite(ops, target, "new", opts);
    expectIoFailed(r, "EXDEV");
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });
});

describe("atomicWrite exact bytes", () => {
  it("preserves CRLF, BOM and a missing trailing newline", async () => {
    const text = "\uFEFFline1\r\nline2\r\nlast";
    expect((await atomicWrite(nodeAtomicFsOps, target, text, opts)).ok).toBe(true);
    expect(readFileSync(target)).toEqual(Buffer.from(text, "utf8"));
    expect(readdirSync(root)).toEqual(["f.md"]);
  });

  it("writes Uint8Array content verbatim, including invalid UTF-8", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0xff, 0xfe, 0x0d, 0x0a, 0x00]);
    expect((await atomicWrite(nodeAtomicFsOps, target, bytes, opts)).ok).toBe(true);
    expect(new Uint8Array(readFileSync(target))).toEqual(bytes);
  });

  it("creates missing parent directories", async () => {
    const deep = join(root, "a", "b", "f.md");
    expect((await atomicWrite(nodeAtomicFsOps, deep, "x", opts)).ok).toBe(true);
    expect(readFileSync(deep, "utf8")).toBe("x");
  });
});
