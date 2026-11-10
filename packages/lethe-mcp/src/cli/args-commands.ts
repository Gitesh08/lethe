// Builds the per-command discriminated union from the validated option map (Req 13.2, 12.4).
import { err, ok, type Result } from "@lethe/core";
import type { OptValue } from "./args-spec.js";
import type { CommandArgs, CommandName, FailOn, UsageError } from "./args-types.js";
import type { DetectScope } from "../ops/detect.js";
import type { RecordType } from "../ops/record.js";

export type OptMap = ReadonlyMap<string, OptValue>;

const usage = (message: string, hint: string): UsageError => ({ message, hint });
const flag = (o: OptMap, k: string): boolean => o.get(k) === true;
const text = (o: OptMap, k: string): string | undefined => {
  const v = o.get(k);
  return typeof v === "string" ? v : undefined;
};
const num = (o: OptMap, k: string): number | undefined => {
  const v = o.get(k);
  return typeof v === "number" ? v : undefined;
};
const strings = (o: OptMap, k: string): ReadonlyArray<string> => {
  const v = o.get(k);
  return Array.isArray(v) ? (v as ReadonlyArray<string>) : [];
};

function buildCheck(o: OptMap): CommandArgs {
  return {
    command: "check", scope: (text(o, "scope") ?? "steering-vs-specs") as DetectScope,
    failOn: (text(o, "fail-on") ?? "any") as FailOn, block: flag(o, "block"),
  };
}

function buildRecord(o: OptMap): Result<CommandArgs, UsageError> {
  const type = text(o, "type");
  if (type === undefined) return err(usage("record requires --type", "lethe record --type <task_passed|spec_cited|manual_pin>"));
  const cited = strings(o, "cited");
  if (type !== "task_passed" && cited.length === 0) {
    return err(usage(`--type ${type} requires a non-empty --cited`, "lethe record --type spec_cited --cited <id,id>"));
  }
  return ok({
    command: "record", type: type as RecordType, files: strings(o, "files"),
    filesFromGit: flag(o, "files-from-git"), cited,
  });
}

function buildSleep(o: OptMap): Result<CommandArgs, UsageError> {
  const apply = flag(o, "apply");
  if (apply && flag(o, "skip-gate")) {
    return err(usage("--skip-gate cannot be combined with --apply", "drop --skip-gate, or run without --apply"));
  }
  const budget = num(o, "budget");
  return ok({
    command: "sleep", apply, skipGate: flag(o, "skip-gate"), gateRuns: num(o, "gate-runs") ?? 100, block: flag(o, "block"),
    ...(budget === undefined ? {} : { budget }),
  });
}

function buildResurrect(o: OptMap): Result<CommandArgs, UsageError> {
  const query = text(o, "query");
  if (query === undefined) return err(usage("resurrect requires --query", 'lethe resurrect --query "<id|text>" [--apply]'));
  return ok({ command: "resurrect", query, apply: flag(o, "apply"), block: flag(o, "block") });
}

export function buildCommand(command: CommandName, o: OptMap): Result<CommandArgs, UsageError> {
  switch (command) {
    case "check": return ok(buildCheck(o));
    case "record": return buildRecord(o);
    case "score": return ok({ command, includeSpecs: flag(o, "include-specs") });
    case "sleep": return buildSleep(o);
    case "resurrect": return buildResurrect(o);
    case "adopt": return ok({ command, apply: flag(o, "apply") });
    case "probe": return ok({ command });
    case "serve": return ok({ command });
    default: {
      const unreachable: never = command;
      return err(usage(`unknown subcommand ${String(unreachable)}`, "see --help"));
    }
  }
}
