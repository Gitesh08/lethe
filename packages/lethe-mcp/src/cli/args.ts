// Strict, dependency-free CLI argument parser (Req 13.1, 13.2, 13.4, 11.3). Pure: no process access, no IO.
// Accepts `--opt value` and `--opt=value`. `--help`/`-h` and `--version` win anywhere in argv.
import { err, ok, type Result } from "@lethe/core";
import { buildCommand, type OptMap } from "./args-commands.js";
import { COMMAND_OPTIONS, GLOBAL_OPTIONS, USAGE_HINT, type OptSpec, type OptValue } from "./args-spec.js";
import {
  COMMAND_NAMES, type CommandName, type GlobalOptions, type ParsedCommand, type UsageError,
} from "./args-types.js";

export type { CommandArgs, CommandName, GlobalOptions, ParsedCommand, UsageError } from "./args-types.js";

const usage = (message: string, hint: string = USAGE_HINT): UsageError => ({ message, hint });
const isCommand = (s: string): s is CommandName => (COMMAND_NAMES as ReadonlyArray<string>).includes(s);

interface Scan {
  command: CommandName | undefined;
  readonly opts: Map<string, OptValue>;
}

function lookup(name: string, command: CommandName | undefined): OptSpec | undefined {
  const own = (t: Readonly<Record<string, OptSpec>>): OptSpec | undefined =>
    Object.hasOwn(t, name) ? t[name] : undefined;
  return own(GLOBAL_OPTIONS) ?? (command === undefined ? undefined : own(COMMAND_OPTIONS[command]));
}

function readOption(
  token: string, next: string | undefined, scan: Scan,
): Result<{ readonly consumedNext: boolean }, UsageError> {
  const eq = token.indexOf("=");
  const name = token.slice(2, eq === -1 ? undefined : eq);
  const spec = lookup(name, scan.command);
  if (spec === undefined) return err(usage(`unknown option --${name}`));
  if (scan.opts.has(name)) return err(usage(`duplicate option --${name}`));
  if (!spec.takesValue) {
    if (eq !== -1) return err(usage(`--${name} does not take a value`));
    scan.opts.set(name, true);
    return ok({ consumedNext: false });
  }
  const inline = eq !== -1;
  const parsed = parseValue(name, spec, inline ? token.slice(eq + 1) : next, inline);
  if (!parsed.ok) return parsed;
  scan.opts.set(name, parsed.value);
  return ok({ consumedNext: !inline });
}

function parseValue(
  name: string, spec: OptSpec, raw: string | undefined, inline: boolean,
): Result<OptValue, UsageError> {
  if (raw === undefined || (!inline && raw.startsWith("--"))) {
    return err(usage(`--${name} requires a value`, `--${name} <${spec.expect}>`));
  }
  const parsed = spec.parse(raw);
  if (parsed === undefined) {
    return err(usage(`invalid value for --${name}: ${JSON.stringify(raw)}`, `--${name} expects ${spec.expect}`));
  }
  return ok(parsed);
}

function scanArgv(argv: ReadonlyArray<string>): Result<Scan, UsageError> {
  const scan: Scan = { command: undefined, opts: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    if (token.startsWith("--")) {
      const r = readOption(token, argv[i + 1], scan);
      if (!r.ok) return r;
      if (r.value.consumedNext) i++;
    } else if (token.startsWith("-") && token !== "-") {
      return err(usage(`unknown option ${token}`));
    } else if (scan.command !== undefined) {
      return err(usage(`unexpected argument ${JSON.stringify(token)}`));
    } else if (isCommand(token)) {
      scan.command = token;
    } else {
      return err(usage(`unknown subcommand ${JSON.stringify(token)}`));
    }
  }
  return ok(scan);
}

function globalsOf(opts: OptMap): GlobalOptions {
  const now = opts.get("now");
  const commit = opts.get("commit");
  const workspace = opts.get("workspace");
  return {
    workspace: typeof workspace === "string" ? workspace : ".",
    json: opts.get("json") === true,
    ...(typeof now === "string" ? { now } : {}),
    ...(typeof commit === "number" ? { commit } : {}),
  };
}

export function parseArgs(argv: ReadonlyArray<string>): Result<ParsedCommand, UsageError> {
  const wantsHelp = argv.includes("--help") || argv.includes("-h");
  if (wantsHelp) {
    const command = argv.find(isCommand);
    return ok(command === undefined ? { kind: "help" } : { kind: "help", command });
  }
  if (argv.includes("--version")) return ok({ kind: "version" });
  const scanned = scanArgv(argv);
  if (!scanned.ok) return scanned;
  const { command, opts } = scanned.value;
  if (command === undefined) return err(usage("missing subcommand"));
  const built = buildCommand(command, opts);
  if (!built.ok) return built;
  return ok({ kind: "run", global: globalsOf(opts), args: built.value });
}
