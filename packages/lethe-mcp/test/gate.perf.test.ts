// First-gate latency in a cold process (Req 14.1, Req 22.1, NFR-1). Generous bound: only a hang fails.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface GateResult {
  readonly status: string;
  readonly numRuns: number;
  readonly ran: number;
  readonly gateMs: number;
  readonly sinceProcessStartMs: number;
}

function runWorker(bundle: string, resultFile: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [bundle, resultFile], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    child.once("error", rej);
    child.once("close", (code) => res({ code, stderr }));
  });
}

describe("PBT gate first-run latency", () => {
  let tmp = "";
  beforeAll(() => { tmp = realpathSync(mkdtempSync(join(tmpdir(), "lethe-gate-perf-"))); });
  afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("runs the real gate (numRuns 100) once in a cold process", async () => {
    const bundle = join(tmp, "gate-worker.mjs");
    // Single-file ESM bundle: the dynamic import of @lethe/core/properties is inlined as a lazy
    // module wrapper, so fast-check and the properties evaluate on the first gate call (cold).
    await build({
      entryPoints: [join(PKG, "test", "support", "gate-worker.ts")],
      outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "silent",
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    });
    const resultFile = join(tmp, "result.json");
    const { code, stderr } = await runWorker(bundle, resultFile);
    expect(code, `worker stderr: ${stderr}`).toBe(0);

    const r = JSON.parse(readFileSync(resultFile, "utf8")) as GateResult;
    // Test-runner stderr (not product stdout): feeds the write-up (task 14.8).
    process.stderr.write(`[gate.perf] gateMs=${r.gateMs.toFixed(0)} sinceProcessStartMs=${r.sinceProcessStartMs.toFixed(0)}\n`);
    expect(r.status).toBe("passed");
    expect(r.numRuns).toBe(100);
    expect(r.gateMs).toBeLessThan(20_000);
  }, 60_000);
});
