import { execFile } from "node:child_process";
import { childEnv } from "./child-env.js";

/** Git access used by the run context. Every method resolves to `undefined` on any failure. */
export interface GitRunner {
  commitCount(root: string): Promise<number | undefined>;
  changedFiles(root: string): Promise<ReadonlyArray<string> | undefined>;
}

export interface GitOptions {
  /** Executable name or path; injectable for tests. */
  readonly command?: string;
  /** Arguments inserted before the git arguments; test seam for fake commands (e.g. `node -e`). */
  readonly prefixArgs?: ReadonlyArray<string>;
  /** Per-command timeout in ms (Req 11.1: 2000). */
  readonly timeoutMs?: number;
  /** Max stdout bytes per command. */
  readonly maxBuffer?: number;
  /** Environment for the child; defaults to the scrubbed environment. */
  readonly env?: () => Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_MAX_BUFFER = 1024 * 1024;

type Run = (root: string, args: ReadonlyArray<string>) => Promise<string | undefined>;

function makeRun(command: string, options: GitOptions): Run {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const envOf = options.env ?? (() => childEnv());
  return (root, args) =>
    new Promise((resolve) => {
      try {
        execFile(
          command,
          [...(options.prefixArgs ?? []), ...args],
          { cwd: root, timeout, maxBuffer, windowsHide: true, shell: false, env: envOf(), encoding: "utf8" },
          (error, stdout) => resolve(error === null ? stdout : undefined),
        );
      } catch {
        resolve(undefined);
      }
    });
}

function parseCount(out: string | undefined): number | undefined {
  if (out === undefined) return undefined;
  const text = out.trim();
  if (!/^[0-9]+$/.test(text)) return undefined;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : undefined;
}

function unionNames(chunks: ReadonlyArray<string>): ReadonlyArray<string> {
  const names = new Set<string>();
  for (const chunk of chunks) {
    for (const raw of chunk.split("\0")) {
      if (raw !== "") names.add(raw.replace(/\\/g, "/"));
    }
  }
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function createGit(options: GitOptions = {}): GitRunner {
  const run = makeRun(options.command ?? "git", options);
  return {
    async commitCount(root) {
      return parseCount(await run(root, ["rev-list", "--count", "HEAD"]));
    },
    async changedFiles(root) {
      const tracked = await run(root, ["diff", "--name-only", "-z", "HEAD"]);
      if (tracked === undefined) return undefined;
      const untracked = await run(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
      if (untracked === undefined) return undefined;
      return unionNames([tracked, untracked]);
    },
  };
}
export const nodeGit: GitRunner = createGit();
