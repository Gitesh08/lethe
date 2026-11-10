// Test harness for in-process CLI runs against temp workspaces. Refs: Req 13.3, 13.4, 13.5, 13.7, 13.8
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runCli, type CliDeps } from "../../src/cli/run.js";
import { stubGate, type GateRunner } from "../../src/gate/gate.js";

export const NOW = "2026-11-10T12:00:00.000Z";
export const FIXED = ["--commit", "5", "--now", NOW] as const;
export const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };

export const failingGate: GateRunner = stubGate({
  status: "failed", propertyId: "P8", seed: 7, counterexample: [1], message: "boom",
});

export interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly logs: ReadonlyArray<string>;
  readonly stdinReads: number;
}

/** Creates a realpath'd temp workspace seeded with relative-path -> text files. */
export function makeWorkspace(files: Readonly<Record<string, string>>): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-cli-matrix-")));
  for (const [rel, text] of Object.entries(files)) putFile(dir, rel, text);
  return dir;
}

export function putFile(dir: string, rel: string, text: string): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
}

/** Writes a live lock file held by this process, so lock acquisition fails with waitMs 0. */
export function holdLock(dir: string): void {
  putFile(dir, ".kiro/lethe/lock", JSON.stringify({
    pid: process.pid, host: hostname(), startedAt: new Date().toISOString(), token: "x",
  }));
}

export async function runIn(
  dir: string, argv: ReadonlyArray<string>, deps: CliDeps = {}, stdin = "",
): Promise<RunResult> {
  const out: string[] = [];
  const err: string[] = [];
  const logs: string[] = [];
  let stdinReads = 0;
  const r = await runCli(argv, {
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    readStdin: async () => { stdinReads++; return stdin; },
    cwd: dir,
  }, {
    git: noGit, lock: { waitMs: 0 }, log: (m: string) => { logs.push(m); }, gate: stubGate("passed"), ...deps,
  });
  return { exitCode: r.exitCode, stdout: out.join(""), stderr: err.join(""), logs, stdinReads };
}

/** True when `text` is exactly one JSON document on one line. */
export function isOneJsonLine(text: string): boolean {
  if (!text.endsWith("\n") || text.trimEnd().includes("\n")) return false;
  try { JSON.parse(text); return true; } catch { return false; }
}
