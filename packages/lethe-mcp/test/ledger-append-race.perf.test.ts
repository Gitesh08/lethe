// Task 6.12: concurrent ledger appenders from real child processes (Req 9.6, Req 10.10).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LEDGER_REL, parseLedger } from "../src/load/ledger-file.js";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKERS = 8;
const PER_WORKER = 50;

interface Exit { readonly id: number; readonly code: number | null; readonly stderr: string }

function runWorker(bundle: string, root: string, id: number): Promise<Exit> {
  return new Promise((resolveExit) => {
    const child = spawn(process.execPath, [bundle, root, String(id), String(PER_WORKER)], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    child.on("error", (e) => resolveExit({ id, code: -1, stderr: String(e) }));
    child.on("close", (code) => resolveExit({ id, code, stderr }));
  });
}

describe("ledger append multi-process race", () => {
  let tmp = "";
  beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), "lethe-append-race-")); });
  afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("concurrent appenders produce whole lines only (Req 9.6, 10.10)", async () => {
    const bundle = join(tmp, "append-worker.mjs");
    await build({
      entryPoints: [join(PKG, "test", "support", "append-worker.ts")],
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      logLevel: "silent",
    });
    const root = join(tmp, "ws");
    mkdirSync(root, { recursive: true });

    const ids = Array.from({ length: WORKERS }, (_, i) => i);
    const exits = await Promise.all(ids.map((id) => runWorker(bundle, root, id)));
    const failed = exits.filter((e) => e.code !== 0);
    expect(failed, failed.map((f) => `worker ${f.id} exit ${String(f.code)}: ${f.stderr}`).join("\n")).toEqual([]);

    const bytes = new Uint8Array(readFileSync(join(root, ...LEDGER_REL.split("/"))));
    const text = new TextDecoder().decode(bytes);
    expect(text.endsWith("\n")).toBe(true);
    const lines = text.split("\n").slice(0, -1);
    expect(lines).toHaveLength(WORKERS * PER_WORKER);
    expect(lines.every((l) => l.length > 2000)).toBe(true); // long lines, beyond small-write sizes
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();

    const read = parseLedger(bytes);
    const codes = read.diagnostics.map((d) => d.code);
    expect(codes).not.toContain("LEDGER_LINE_SKIPPED");
    expect(codes).not.toContain("LEDGER_TORN_TAIL");
    expect(read.events).toHaveLength(WORKERS * PER_WORKER);
    const seen = new Set(read.events.map((e) => e.commit));
    expect(seen.size).toBe(WORKERS * PER_WORKER);
    for (const w of ids) for (let i = 0; i < PER_WORKER; i++) expect(seen.has(w * 1000 + i)).toBe(true);
  }, 120_000);
});
