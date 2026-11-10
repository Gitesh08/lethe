// Bundle performance: cold start (spawn -> initialize + tools/list) and warm score. Refs: Req 22.1, Req 22.2, NFR-1
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { childEnv } from "../src/io/child-env.js";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = join(PKG, "dist", "lethe.mjs");
const NOW = "2026-11-10T12:00:00.000Z";

function makeWorkspace(root: string, files: number, sections: number): void {
  const dir = join(root, ".kiro", "steering");
  mkdirSync(dir, { recursive: true });
  for (let f = 0; f < files; f++) {
    let text = "";
    for (let s = 0; s < sections; s++) {
      const n = f * sections + s;
      text += `## Heading ${n}\n\nBody text ${n}.\n\n`;
    }
    writeFileSync(join(dir, `file-${String(f).padStart(3, "0")}.md`), text);
  }
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
};

const newTransport = (cwd: string): StdioClientTransport =>
  new StdioClientTransport({ command: process.execPath, args: [BUNDLE, "serve"], cwd, env: childEnv(), stderr: "ignore" });

describe("bundle performance", () => {
  let tmp = "";
  let ws100 = "";
  let ws500 = "";
  let coldMedian = Number.NaN;
  let scoreMedian = Number.NaN;

  beforeAll(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "lethe-bundle-perf-")));
    ws100 = join(tmp, "ws100");
    ws500 = join(tmp, "ws500");
    makeWorkspace(ws100, 5, 20);
    makeWorkspace(ws500, 25, 20);
  });
  afterAll(() => {
    process.stderr.write(`[bundle.perf] coldStartMedianMs=${coldMedian.toFixed(1)} scoreMedianMs=${scoreMedian.toFixed(1)}\n`);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("cold start: spawn to initialize + tools/list, median of 5 < 500 ms", async () => {
    const once = async (): Promise<number> => {
      const t0 = performance.now();
      const client = new Client({ name: "perf", version: "0.0.0" });
      await client.connect(newTransport(ws100));
      const tools = await client.listTools();
      const ms = performance.now() - t0;
      expect(tools.tools).toHaveLength(4);
      await client.close();
      return ms;
    };
    await once(); // warm-up
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push(await once());
    coldMedian = median(runs);
    expect(coldMedian).toBeLessThan(500);
  }, 60_000);

  it("score: warm process, 500 engrams, median of 9 < 250 ms", async () => {
    const client = new Client({ name: "perf", version: "0.0.0" });
    await client.connect(newTransport(ws500));
    try {
      const call = async (): Promise<number> => {
        const t0 = performance.now();
        const res = await client.callTool({
          name: "lethe_score_memories",
          arguments: { workspacePath: ws500, atCommit: 100, now: NOW },
        });
        const ms = performance.now() - t0;
        expect(res.isError).toBe(false);
        const env = res.structuredContent as { ok: boolean; data: { engrams: unknown[] } };
        expect(env.ok).toBe(true);
        expect(env.data.engrams).toHaveLength(500);
        return ms;
      };
      await call(); // warm-up
      const runs: number[] = [];
      for (let i = 0; i < 9; i++) runs.push(await call());
      scoreMedian = median(runs);
      expect(scoreMedian).toBeLessThan(250);
    } finally {
      await client.close();
    }
  }, 60_000);
});
