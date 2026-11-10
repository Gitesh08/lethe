// recordOp with the lock genuinely held by another process (Req 12.7): event appended, STATE_NOT_UPDATED, state untouched.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildContext } from "../src/ops/context.js";
import { recordOp } from "../src/ops/record.js";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = "2026-11-10T12:00:00.000Z";

describe("recordOp under a held lock", () => {
  let tmp = "";
  let child: ChildProcess | undefined;

  beforeAll(() => { tmp = realpathSync(mkdtempSync(join(tmpdir(), "lethe-record-lock-"))); });
  afterAll(async () => {
    if (child !== undefined && child.exitCode === null) {
      const closed = new Promise<void>((r) => child?.once("close", () => r()));
      child.kill();
      await closed;
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it("degrades to STATE_NOT_UPDATED after the 1000 ms budget, keeping the event", async () => {
    const bundle = join(tmp, "lock-holder.mjs");
    await build({
      entryPoints: [join(PKG, "test", "support", "lock-holder.ts")],
      outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "silent",
    });
    const root = join(tmp, "ws");
    mkdirSync(join(root, ".kiro", "steering"), { recursive: true });
    writeFileSync(join(root, ".kiro", "steering", "a.md"), "## A\n\nUse ESM modules.\n");
    const ready = join(tmp, "ready.txt");
    child = spawn(process.execPath, [bundle, root, ready, "60000"], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    for (let i = 0; i < 400 && !existsSync(ready); i++) await sleep(25);
    expect(existsSync(ready), `holder never became ready: ${stderr}`).toBe(true);

    const built = await buildContext({ workspacePath: root, commit: 7, now: NOW }, {
      git: { commitCount: async () => undefined, changedFiles: async () => undefined },
      log: () => undefined,
    });
    if (!built.ok) throw new Error(built.error.message);
    const statePath = join(root, ".kiro", "lethe", "state.json");
    const stateBefore = existsSync(statePath) ? readFileSync(statePath, "utf8") : undefined;

    const t0 = performance.now();
    const r = await recordOp(built.value, { type: "task_passed", files: ["a.ts"] });
    const elapsed = performance.now() - t0;

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.degraded).toBe(true);
    expect(r.value.stateUpdated).toBe(false);
    expect(r.value.diagnostics.map((d) => d.code)).toContain("STATE_NOT_UPDATED");
    expect(readFileSync(join(root, ".kiro", "lethe", "ledger.jsonl"), "utf8")).toContain('"filesTouched":["a.ts"]');
    expect(existsSync(statePath) ? readFileSync(statePath, "utf8") : undefined).toBe(stateBefore);
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(10_000);
  }, 30_000);
});
