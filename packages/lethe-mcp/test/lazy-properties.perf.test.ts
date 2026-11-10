// The properties module (and fast-check) load lazily: never for skipGate ops, once for gated ones.
// Refs: Req 14.6, REQ-MCP-5.
//
// Approach: a child process runs a bundled worker (test/support/lazy-worker.ts). An esbuild plugin appends a
// one-line probe to the evaluated source of the `@lethe/core/properties` entry and of fast-check's entry, which
// pushes the module name onto globalThis.__letheLoads when the module body runs. In the bundle, the dynamic
// import in gate.ts becomes a lazy init wrapper, so the probe fires exactly on the first evaluation. The
// worker snapshots the list after each phase and the parent asserts on the snapshots. Everything is bundled
// into a temp dir, so no module-resolution tricks are needed (core exports raw .ts, unusable as a Node external).
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROBE = (name: string): string => `\n;(globalThis.__letheLoads ??= []).push(${JSON.stringify(name)});\n`;

const probePlugin: Plugin = {
  name: "lethe-load-probe",
  setup(b) {
    const targets: ReadonlyArray<{ re: RegExp; name: string; loader: "ts" | "js" }> = [
      { re: /lethe-core[\\/]src[\\/]properties[\\/]index\.ts$/, name: "properties", loader: "ts" },
      { re: /node_modules[\\/]fast-check[\\/]lib[\\/](esm[\\/])?fast-check\.js$/, name: "fast-check", loader: "js" },
    ];
    for (const t of targets) {
      b.onLoad({ filter: t.re }, (args) => ({ contents: readFileSync(args.path, "utf8") + PROBE(t.name), loader: t.loader }));
    }
  },
};

interface Result {
  readonly snaps: Record<string, string[]>;
  readonly gates: string[];
}

function run(bundle: string, dir: string, out: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [bundle, dir, out], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    child.once("error", rej);
    child.once("close", (code) => res({ code, stderr }));
  });
}

describe("properties module loads lazily", () => {
  let tmp = "";
  beforeAll(() => { tmp = realpathSync(mkdtempSync(join(tmpdir(), "lethe-lazy-"))); });
  afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("is not loaded by skipGate ops, and loads exactly once across gated runs", async () => {
    const bundle = join(tmp, "lazy-worker.mjs");
    await build({
      entryPoints: [join(PKG, "test", "support", "lazy-worker.ts")],
      outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "silent",
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
      plugins: [probePlugin],
    });
    const out = join(tmp, "result.json");
    const { code, stderr } = await run(bundle, join(tmp, "ws"), out);
    expect(code, `worker stderr: ${stderr}`).toBe(0);

    const r = JSON.parse(readFileSync(out, "utf8")) as Result;
    expect(r.gates).toEqual(["skipped", "passed", "passed"]);
    expect(r.snaps["atStart"]).toEqual([]);
    expect(r.snaps["afterSkipGate"]).toEqual([]);
    const first = r.snaps["afterFirstGate"] ?? [];
    expect(first.filter((m) => m === "properties")).toHaveLength(1);
    expect(first.filter((m) => m === "fast-check")).toHaveLength(1);
    expect(r.snaps["afterSecondGate"]).toEqual(first);
  }, 60_000);
});
