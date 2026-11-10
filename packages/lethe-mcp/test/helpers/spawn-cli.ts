// Spawned-process helper: bundles the CLI entry once and runs `node lethe.mjs <args>` (task 10.7).
// Uses the real `buildBundle()` from scripts/build.mjs (task 11.2). Refs: Req 13.7, 13.8, 13.9, 21.3
import { spawn } from "node:child_process";
import { join } from "node:path";
import { buildBundle } from "../../scripts/build.mjs";
import { childEnv } from "../../src/io/child-env.js";

export interface SpawnResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Bundles src/cli.ts into `<dir>/lethe.mjs` (the name matters: the entry guard accepts `lethe.mjs`). */
export async function buildTempBundle(dir: string): Promise<string> {
  const outfile = join(dir, "lethe.mjs");
  await buildBundle({ outfile });
  return outfile;
}

/**
 * Runs the bundle with a scrubbed environment and stdin closed (`"ignore"`): a command that read stdin
 * would see EOF/EBADF instead of blocking, and the timeout guard fails the test if the child hangs.
 */
export function spawnCli(
  bundle: string, args: ReadonlyArray<string>, cwd: string, timeoutMs = 30_000,
): Promise<SpawnResult> {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [bundle, ...args], {
      cwd, env: childEnv(), stdio: ["ignore", "pipe", "pipe"], shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    const timer = setTimeout(() => {
      child.kill();
      rej(new Error(`lethe ${args.join(" ")} did not exit within ${timeoutMs} ms (blocked on stdin?)`));
    }, timeoutMs);
    child.once("error", (e) => { clearTimeout(timer); rej(e); });
    child.once("close", (code) => { clearTimeout(timer); res({ code, stdout, stderr }); });
  });
}
