// Exit-code matrix (Req 13.3; design "CLI exit-code matrix"). Pure: no process access.
// API: exitCodeFor(command, outcome, flags) -> number, where outcome is an Envelope or a usage error.
import type { Envelope } from "../envelope/envelope.js";
import type { ToolErrorCode } from "../envelope/errors.js";
import type { CliCommandName } from "./command-name.js";

export type FailOn = "any" | "unresolvable" | "never";

export interface ExitFlags {
  readonly failOn?: FailOn | undefined;
  readonly block?: boolean | undefined;
  readonly json?: boolean | undefined;
}

export interface UsageOutcome {
  readonly kind: "usage";
  readonly message: string;
  readonly hint: string;
}

export type CliOutcome = Envelope<unknown> | UsageOutcome;

export const EXIT_OK = 0;
export const EXIT_FINDING = 1;
export const EXIT_BLOCK = 2;
export const EXIT_USAGE = 64;
export const EXIT_INTERNAL = 70;
export const EXIT_IO = 74;

/**
 * Base exit code per error code. A value of EXIT_FINDING marks a "finding-class" failure
 * (gate failed, nothing to resurrect) which `--block` upgrades to 2. Adding a ToolErrorCode
 * fails typecheck until it is mapped here.
 */
export const ERROR_EXIT: Readonly<Record<ToolErrorCode, number>> = {
  PARSE_INVALID_FRONTMATTER: EXIT_IO,
  PARSE_DUPLICATE_ID: EXIT_IO,
  CONFIG_INVALID: EXIT_IO,
  ONTOLOGY_INVALID_PATTERN: EXIT_IO,
  BUDGET_INFEASIBLE: EXIT_IO,
  TOMBSTONE_NOT_FOUND: EXIT_FINDING,
  PATH_ESCAPE: EXIT_IO,
  PBT_GATE_FAILED: EXIT_FINDING,
  INVALID_INPUT: EXIT_IO,
  LOCKED: EXIT_IO,
  IO_FAILED: EXIT_IO,
  INTERNAL_ERROR: EXIT_INTERNAL,
};

export function isUsageOutcome(o: CliOutcome): o is UsageOutcome {
  return "kind" in o && o.kind === "usage";
}

const findingCode = (block: boolean | undefined): number => (block === true ? EXIT_BLOCK : EXIT_FINDING);

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/** True when a successful `check` (detect) payload has findings matching `failOn`. */
export function checkHasFindings(data: unknown, failOn: FailOn): boolean {
  if (failOn === "never" || !isRecord(data)) return false;
  const count = typeof data["count"] === "number" ? data["count"] : 0;
  const unresolvable = typeof data["unresolvable"] === "number" ? data["unresolvable"] : 0;
  return failOn === "any" ? count > 0 : unresolvable > 0;
}

function successExit(command: CliCommandName, data: unknown, flags: ExitFlags): number {
  if (command === "check") {
    return checkHasFindings(data, flags.failOn ?? "any") ? findingCode(flags.block) : EXIT_OK;
  }
  if (command === "sleep" && isRecord(data) && data["pbtGate"] === "failed") return findingCode(flags.block);
  return EXIT_OK;
}

export function exitCodeFor(command: CliCommandName, outcome: CliOutcome, flags: ExitFlags): number {
  if (isUsageOutcome(outcome)) return EXIT_USAGE;
  if (outcome.ok) return successExit(command, outcome.data, flags);
  const base = ERROR_EXIT[outcome.error.code];
  return base === EXIT_FINDING ? findingCode(flags.block) : base;
}
