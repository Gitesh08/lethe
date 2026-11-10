// Process entry (bundle entry, task 11.1): argv -> runCli -> flush -> exit code.
// The ONLY module that calls process.exit (Req 13.1, 13.3, 19.1). Importing it has no side effects;
// main() runs only when this file is the executed entry.
// `serve` ignores its workspace argument: every MCP tool call carries its own `workspacePath`.
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runCli, type CliIo } from "./cli/run.js";
import { readLimited } from "./cli/stdin.js";
import { createStdout, writeStdout } from "./io/stdout.js";
import { serveStdio } from "./server-stdio.js";

/** Builds the real CliIo; `flush` resolves once every queued write has been handed to the OS. */
export function createProcessIo(argv: ReadonlyArray<string>): { readonly io: CliIo; flush(): Promise<void> } {
  const pending: Promise<void>[] = [];
  const errOut = createStdout(process.stderr).writeStdout;
  const track = (p: Promise<void>): void => void pending.push(p.catch(() => undefined));
  const io: CliIo = {
    stdout: (text) => track(writeStdout(text)),
    stderr: (text) => track(errOut(text)),
    readStdin: (limits) => readLimited(process.stdin, limits),
    cwd: process.cwd(),
    argv,
  };
  return { io, flush: async () => void (await Promise.all(pending)) };
}

/** Runs the CLI once and returns the exit code with all output flushed. Does not exit. */
export async function main(argv: ReadonlyArray<string>): Promise<number> {
  const { io, flush } = createProcessIo(argv);
  const { exitCode } = await runCli(argv, io, { serve: () => serveStdio() });
  await flush();
  return exitCode;
}

const BIN_NAMES: ReadonlySet<string> = new Set(["lethe", "lethe.mjs", "lethe.cmd"]);

function isEntry(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  if (pathToFileURL(resolve(entry)).href === import.meta.url) return true;
  // npm bin symlinks: argv[1] is the link path while import.meta.url is the real file.
  return BIN_NAMES.has(basename(entry));
}

if (isEntry()) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      process.stderr.write(`lethe: fatal: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    },
  );
}
