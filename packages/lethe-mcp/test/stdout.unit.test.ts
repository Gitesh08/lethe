// Requirement 19.1 / 19.2 / INV-8: protocol output on stdout only, logs on stderr only.
// Validates: Requirements 19.1, 19.2
import { describe, expect, it } from "vitest";
import { createLogger, createStdout, defaultStdout, log, writeStdout, type WritableLike } from "../src/io/stdout.js";

type Cb = (error?: Error | null) => void;

function recorder(opts: { readonly fail?: Error } = {}): WritableLike & { readonly chunks: string[] } {
  const chunks: string[] = [];
  return {
    chunks,
    write(chunk: string, callback?: Cb): boolean {
      chunks.push(chunk);
      queueMicrotask(() => callback?.(opts.fail ?? null));
      return true;
    },
  };
}

describe("writeStdout", () => {
  it("writes exact bytes to the injected stream exactly once", async () => {
    const out = recorder();
    await createStdout(out).writeStdout('{"jsonrpc":"2.0"}\n');
    expect(out.chunks).toEqual(['{"jsonrpc":"2.0"}\n']);
  });

  it("resolves on EPIPE instead of throwing", async () => {
    const epipe = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    await expect(createStdout(recorder({ fail: epipe })).writeStdout("x")).resolves.toBeUndefined();
  });

  it("rejects on other write errors", async () => {
    await expect(createStdout(recorder({ fail: new Error("boom") })).writeStdout("x")).rejects.toThrow("boom");
  });
});

describe("logger", () => {
  it("writes lines to the injected stderr only, never to stdout", async () => {
    const out = recorder();
    const err = recorder();
    const stdout = createStdout(out);
    createLogger({ stream: err, prefix: "[lethe]" })("hello");
    createLogger({ stream: err })("plain");
    expect(err.chunks).toEqual(["[lethe] hello\n", "plain\n"]);
    expect(out.chunks).toEqual([]);
    await stdout.writeStdout("proto");
    expect(err.chunks).toHaveLength(2);
  });
});

describe("default bindings", () => {
  it("are bound to the real process streams", async () => {
    // Identity check via a spy-free probe: the defaults must exist and be functions; no real writes.
    expect(typeof writeStdout).toBe("function");
    expect(typeof log).toBe("function");
    expect(defaultStdout.writeStdout).toBe(writeStdout);
    const realWrite = process.stdout.write;
    const realErrWrite = process.stderr.write;
    const seen: string[] = [];
    process.stdout.write = ((chunk: string, cb?: Cb): boolean => { seen.push(`out:${chunk}`); cb?.(null); return true; }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string): boolean => { seen.push(`err:${chunk}`); return true; }) as typeof process.stderr.write;
    try {
      await writeStdout("a");
      log("b");
    } finally {
      process.stdout.write = realWrite;
      process.stderr.write = realErrWrite;
    }
    expect(seen).toEqual(["out:a", "err:b\n"]);
  });
});
