// Task 4.12: multi-process lock race (Req 9.1, 9.5, INV-4). Real processes run the real lock code.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKERS = 8;

interface Exit { readonly id: number; readonly code: number | null; readonly stderr: string }

function runWorker(bundle: string, root: string, id: number, log: string, counter: string): Promise<Exit> {
  return new Promise((resolveExit) => {
    const child = spawn(process.execPath, [bundle, root, String(id), log, counter], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    child.on("error", (e) => resolveExit({ id, code: -1, stderr: String(e) }));
    child.on("close", (code) => resolveExit({ id, code, stderr }));
  });
}

describe("lock multi-process race", () => {
  let tmp = "";

  beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), "lethe-lock-race-")); });
  afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("serialises critical sections across processes (Req 9.1, 9.5)", async () => {
    const bundle = join(tmp, "lock-worker.mjs");
    await build({
      entryPoints: [join(PKG, "test", "support", "lock-worker.ts")],
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      logLevel: "silent",
    });
    const root = join(tmp, "ws");
    mkdirSync(root, { recursive: true });
    const log = join(tmp, "log.txt");
    const counter = join(tmp, "counter.txt");
    writeFileSync(log, "");
    writeFileSync(counter, "0");

    const ids = Array.from({ length: WORKERS }, (_, i) => i);
    const exits = await Promise.all(ids.map((id) => runWorker(bundle, root, id, log, counter)));

    const failed = exits.filter((e) => e.code !== 0);
    expect(failed, failed.map((f) => `worker ${f.id} exit ${String(f.code)}: ${f.stderr}`).join("\n")).toEqual([]);

    const lines = readFileSync(log, "utf8").split("\n").filter((l) => l !== "");
    expect(lines).toHaveLength(WORKERS * 2);
    const seen = new Set<string>();
    let prevT = -1n;
    for (let i = 0; i < lines.length; i += 2) {
      const [kindA, idA, tA] = (lines[i] ?? "").split(" ");
      const [kindB, idB, tB] = (lines[i + 1] ?? "").split(" ");
      expect([kindA, kindB], `lines ${i}-${i + 1}: ${lines.slice(i, i + 2).join(" | ")}`).toEqual(["enter", "exit"]);
      expect(idB).toBe(idA);
      expect(seen.has(idA ?? "")).toBe(false);
      seen.add(idA ?? "");
      const enter = BigInt(tA ?? "0");
      const exit = BigInt(tB ?? "0");
      expect(enter).toBeGreaterThanOrEqual(prevT); // no overlap with previous section
      expect(exit).toBeGreaterThanOrEqual(enter);
      prevT = exit;
    }
    expect(seen.size).toBe(WORKERS);
    expect(Number(readFileSync(counter, "utf8"))).toBe(WORKERS);
    expect(() => readFileSync(join(root, ".kiro", "lethe", "lock"), "utf8")).toThrow(); // released
  }, 60_000);
});
