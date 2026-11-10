// Types for the CLI argument parser (Req 13.1, 13.2, 13.4). Pure data; no behaviour.
import type { DetectScope } from "../ops/detect.js";
import type { RecordType } from "../ops/record.js";

export const COMMAND_NAMES = ["check", "record", "score", "sleep", "resurrect", "adopt", "probe", "serve"] as const;
export type CommandName = (typeof COMMAND_NAMES)[number];

export const FAIL_ON_VALUES = ["any", "unresolvable", "never"] as const;
export type FailOn = (typeof FAIL_ON_VALUES)[number];

export const SCOPE_VALUES: ReadonlyArray<DetectScope> = ["steering-vs-specs", "all"];
export const RECORD_TYPES: ReadonlyArray<RecordType> = ["task_passed", "spec_cited", "manual_pin"];

export interface GlobalOptions {
  /** Raw `--workspace` value; defaults to "." (resolved against cwd by the caller). */
  readonly workspace: string;
  readonly json: boolean;
  readonly now?: string;
  readonly commit?: number;
}

/** A usage error (exit 64): a message plus a one-line hint for stderr. */
export interface UsageError {
  readonly message: string;
  readonly hint: string;
}

export type CommandArgs =
  | { readonly command: "check"; readonly scope: DetectScope; readonly failOn: FailOn; readonly block: boolean }
  | {
      readonly command: "record";
      readonly type: RecordType;
      readonly files: ReadonlyArray<string>;
      readonly filesFromGit: boolean;
      readonly cited: ReadonlyArray<string>;
    }
  | { readonly command: "score"; readonly includeSpecs: boolean }
  | {
      readonly command: "sleep";
      readonly apply: boolean;
      readonly skipGate: boolean;
      readonly gateRuns: number;
      readonly block: boolean;
      readonly budget?: number;
    }
  | { readonly command: "resurrect"; readonly query: string; readonly apply: boolean; readonly block: boolean }
  | { readonly command: "adopt"; readonly apply: boolean }
  | { readonly command: "probe" }
  | { readonly command: "serve" };

export type ParsedCommand =
  | { readonly kind: "help"; readonly command?: CommandName }
  | { readonly kind: "version" }
  | { readonly kind: "run"; readonly global: GlobalOptions; readonly args: CommandArgs };
