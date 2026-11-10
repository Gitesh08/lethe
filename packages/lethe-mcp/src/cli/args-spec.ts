// Option tables for the CLI parser: which options exist, which take values, and how values are validated.
import { isIsoInstant } from "../load/commit-counter.js";
import { FAIL_ON_VALUES, RECORD_TYPES, SCOPE_VALUES, type CommandName } from "./args-types.js";

export type OptValue = string | number | boolean | ReadonlyArray<string>;

export interface OptSpec {
  readonly takesValue: boolean;
  /** Human description of the accepted value (for error text). */
  readonly expect: string;
  /** Returns undefined when the value is malformed. */
  readonly parse: (raw: string) => OptValue | undefined;
}

const FLAG: OptSpec = { takesValue: false, expect: "", parse: () => true };

const int = (min: number, max: number) => (raw: string): number | undefined => {
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : undefined;
};

const oneOf = (values: ReadonlyArray<string>) => (raw: string): string | undefined =>
  values.includes(raw) ? raw : undefined;

const list = (raw: string): ReadonlyArray<string> =>
  raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);

const value = (expect: string, parse: OptSpec["parse"]): OptSpec => ({ takesValue: true, expect, parse });

export const GLOBAL_OPTIONS: Readonly<Record<string, OptSpec>> = {
  workspace: value("a path", (r) => (r.length > 0 ? r : undefined)),
  json: FLAG,
  now: value("an ISO 8601 date-time with Z or an offset", (r) => (isIsoInstant(r) ? r : undefined)),
  commit: value("a non-negative integer", int(0, Number.MAX_SAFE_INTEGER)),
};

const APPLY: Readonly<Record<string, OptSpec>> = { apply: FLAG };

export const COMMAND_OPTIONS: Readonly<Record<CommandName, Readonly<Record<string, OptSpec>>>> = {
  check: {
    scope: value(SCOPE_VALUES.join("|"), oneOf(SCOPE_VALUES)),
    "fail-on": value(FAIL_ON_VALUES.join("|"), oneOf(FAIL_ON_VALUES)),
    block: FLAG,
  },
  record: {
    type: value(RECORD_TYPES.join("|"), oneOf(RECORD_TYPES)),
    files: value("a comma-separated list", list),
    "files-from-git": FLAG,
    cited: value("a comma-separated list", list),
  },
  score: { "include-specs": FLAG },
  sleep: {
    ...APPLY,
    budget: value("a positive integer", int(1, Number.MAX_SAFE_INTEGER)),
    "skip-gate": FLAG,
    "gate-runs": value("an integer from 1 to 10000", int(1, 10000)),
    block: FLAG,
  },
  resurrect: { query: value("non-empty text", (r) => (r.length > 0 ? r : undefined)), ...APPLY, block: FLAG },
  adopt: { ...APPLY },
  probe: {},
  serve: {},
};

export const USAGE_HINT = "usage: lethe <check|record|score|sleep|resurrect|adopt|probe|serve> [options]; try --help";
