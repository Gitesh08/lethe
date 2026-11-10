// In-process CLI runner (Req 13.2, 13.9, 11.3, 6.4). Never calls process.exit; never writes outside `io`.
// API: runCli(argv, io, deps) -> { exitCode }. Only `probe` reads stdin. `serve` is delegated to deps.serve.
import { resolve } from "node:path";
import type { Result } from "@lethe/core";
import { fail, ok, type Envelope } from "../envelope/envelope.js";
import { fromUnknown, type ToolError } from "../envelope/errors.js";
import { defaultGateRunner } from "../gate/gate.js";
import { log as stderrLog, type Logger } from "../io/stdout.js";
import { adoptOp, adoptSummary } from "../ops/adopt.js";
import { buildContext, type ContextDeps, type RunContext } from "../ops/context.js";
import { detectContradictionsOp } from "../ops/detect.js";
import { PROBE_MAX_STDIN_BYTES, probeOp } from "../ops/probe.js";
import { recordOp } from "../ops/record.js";
import { resurrectOp } from "../ops/resurrect.js";
import { scoreMemories } from "../ops/score.js";
import { sleepOp, sleepSummary } from "../ops/sleep.js";
import { LETHE_MCP_VERSION } from "../version.js";
import { parseArgs, type CommandArgs, type GlobalOptions } from "./args.js";
import { exitCodeFor, type CliOutcome, type ExitFlags } from "./exit-code.js";
import { helpText } from "./help.js";
import { render } from "./render.js";

export const PROBE_STDIN_TIMEOUT_MS = 2000;

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Called only by `probe`. Must resolve at EOF, the byte cap, or the time limit. */
  readonly readStdin: (limits: { readonly maxBytes: number; readonly timeoutMs: number }) => Promise<string>;
  readonly cwd: string;
  /** argv recorded by `probe`; defaults to the argv given to runCli. */
  readonly argv?: ReadonlyArray<string>;
}

export interface CliDeps extends ContextDeps {
  /** Starts the MCP server for `serve`; returns an exit code. Absent: `serve` is a usage error. */
  readonly serve?: (workspace: string, log: Logger) => Promise<number>;
}

export interface CliResult {
  readonly exitCode: number;
}

type RunArgs = Extract<ReturnType<typeof parseArgs> extends Result<infer P, unknown> ? P : never, { kind: "run" }>;

const toEnvelope = <D>(r: Result<D, ToolError>, summary: (d: D) => string): Envelope<D> =>
  r.ok ? ok(summary(r.value), r.value) : fail(r.error);

async function dispatch(args: CommandArgs, ctx: RunContext, io: CliIo, argv: ReadonlyArray<string>): Promise<Envelope<unknown>> {
  switch (args.command) {
    case "check": return detectContradictionsOp(ctx, { scope: args.scope });
    case "score": return scoreMemories(ctx, { includeSpecs: args.includeSpecs });
    case "sleep":
      return toEnvelope(await sleepOp(ctx, {
        apply: args.apply, skipGate: args.skipGate, gateRuns: args.gateRuns, budgetTokens: args.budget,
      }), sleepSummary);
    case "resurrect":
      return toEnvelope(await resurrectOp(ctx, { query: args.query, apply: args.apply }), (d) =>
        `${d.matches.length} archived engram(s) matched${d.restored === undefined ? " (dry-run)" : `; restored ${d.restored.length}`}.`);
    case "record":
      return toEnvelope(await recordOp(ctx, {
        type: args.type, files: args.files, cited: args.cited, filesFromGit: args.filesFromGit,
      }), (d) => d.summary);
    case "adopt": return toEnvelope(await adoptOp(ctx, { apply: args.apply }), (d) => adoptSummary(d, args.apply));
    case "probe": {
      const stdin = await io.readStdin({ maxBytes: PROBE_MAX_STDIN_BYTES, timeoutMs: PROBE_STDIN_TIMEOUT_MS });
      return toEnvelope(await probeOp(ctx, { stdin, argv: io.argv ?? argv, cwd: io.cwd }),
        (d) => `Captured ${d.event} payload to ${d.file}.`);
    }
    case "serve": return fail({ code: "INVALID_INPUT", message: "serve is started by the process entry point" });
    default: {
      const unreachable: never = args;
      return unreachable;
    }
  }
}

const flagsOf = (g: GlobalOptions, a: CommandArgs): ExitFlags =>
  a.command === "check" ? { json: g.json, failOn: a.failOn, block: a.block }
  : a.command === "sleep" || a.command === "resurrect" ? { json: g.json, block: a.block } : { json: g.json };

function emit(io: CliIo, command: CommandArgs["command"], outcome: CliOutcome, flags: ExitFlags): CliResult {
  const out = render(command, outcome, flags);
  if (out.stdout !== "") io.stdout(out.stdout);
  if (out.stderr !== "") io.stderr(out.stderr);
  return { exitCode: exitCodeFor(command, outcome, flags) };
}

async function runParsed(run: RunArgs, io: CliIo, deps: CliDeps, argv: ReadonlyArray<string>): Promise<CliResult> {
  const { global: g, args } = run;
  const flags = flagsOf(g, args);
  const log = deps.log ?? stderrLog;
  const workspacePath = resolve(io.cwd, g.workspace);
  if (args.command === "serve") {
    if (deps.serve !== undefined) return { exitCode: await deps.serve(workspacePath, log) };
    return emit(io, "serve", { kind: "usage", message: "serve is started by the process entry point", hint: "run `lethe serve` via the lethe executable" }, flags);
  }
  const built = await buildContext(
    { workspacePath, commit: g.commit, now: g.now },
    { ...deps, gate: deps.gate ?? defaultGateRunner },
  );
  const outcome = built.ok ? await dispatch(args, built.value, io, argv) : fail(built.error);
  return emit(io, args.command, outcome, flags);
}

export async function runCli(argv: ReadonlyArray<string>, io: CliIo, deps: CliDeps = {}): Promise<CliResult> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    const json = argv.includes("--json");
    return emit(io, "check", { kind: "usage", ...parsed.error }, { json });
  }
  const cmd = parsed.value;
  if (cmd.kind === "help") { io.stdout(helpText(cmd.command)); return { exitCode: 0 }; }
  if (cmd.kind === "version") { io.stdout(`${LETHE_MCP_VERSION}\n`); return { exitCode: 0 }; }
  try {
    return await runParsed(cmd, io, deps, argv);
  } catch (e) {
    const error = fromUnknown(e, deps.log ?? stderrLog);
    return emit(io, cmd.args.command, fail(error), { json: cmd.global.json });
  }
}
