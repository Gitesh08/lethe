// CLI rendering (Req 13.7, 13.8, 15.5, 15.6; Rules-12). Pure: returns text for the caller to write.
// API: render(command, outcome, flags) -> { stdout, stderr }
//   --json: exactly one Envelope + "\n" on stdout, stderr empty (also for usage errors and failures).
//   human : text on stdout at exit 0, on stderr otherwise.
import { envelopeText, fail, type Envelope } from "../envelope/envelope.js";
import { toolError } from "../envelope/errors.js";
import type { CliCommandName } from "./command-name.js";
import { exitCodeFor, isUsageOutcome, type CliOutcome, type ExitFlags } from "./exit-code.js";
import { formatReports } from "./render-reports.js";

export interface Rendered {
  readonly stdout: string;
  readonly stderr: string;
}

export const HOOK_OUTPUT_CAP = 2000;

const ESTIMATED = "estimated utility";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/** Reinforcement is a heuristic: wherever it is mentioned, say so (Rules-12). */
export function labelEstimated(text: string): string {
  if (!/reinforce/i.test(text) || text.toLowerCase().includes(ESTIMATED)) return text;
  return `${text} (${ESTIMATED})`;
}

/** Cuts text to the cap (code units) with a one-line cut notice. */
export function capText(text: string, cap: number = HOOK_OUTPUT_CAP): string {
  if (text.length <= cap) return text;
  const note = "\n... output cut to fit the hook limit";
  return text.slice(0, cap - note.length) + note;
}

function extraLines(command: CliCommandName, data: unknown): string[] {
  if (!isRecord(data)) return [];
  if (command === "sleep" && isRecord(data["gateFailure"])) {
    const g = data["gateFailure"];
    return [`PBT gate failed: ${String(g["propertyId"])} (seed ${String(g["seed"])}).`];
  }
  if (command === "resurrect" && Array.isArray(data["matches"])) {
    return data["matches"].filter(isRecord).map((m) => `- ${String(m["id"])} (${String(m["file"])})`);
  }
  return [];
}

function humanSuccess(command: CliCommandName, env: Extract<Envelope<unknown>, { ok: true }>): string {
  if (command === "check") return formatReports(env.summary, env.data, HOOK_OUTPUT_CAP);
  const base = command === "record" ? labelEstimated(`${env.summary} Reinforcement is an estimate.`) : labelEstimated(env.summary);
  const lines = [base, ...extraLines(command, env.data)];
  return lines.join("\n") + "\n";
}

function humanFailure(command: CliCommandName, env: Extract<Envelope<unknown>, { ok: false }>): string {
  const text = `${env.error.code}: ${env.error.message}\n`;
  return command === "check" ? capText(text) : text;
}

function humanText(command: CliCommandName, outcome: CliOutcome): string {
  if (isUsageOutcome(outcome)) return `${outcome.message}\n${outcome.hint}\n`;
  return outcome.ok ? humanSuccess(command, outcome) : humanFailure(command, outcome);
}

function jsonEnvelope(outcome: CliOutcome): Envelope<unknown> {
  if (!isUsageOutcome(outcome)) return outcome;
  return fail(toolError("INVALID_INPUT", outcome.message, { hint: outcome.hint, usage: true }));
}

export function render(command: CliCommandName, outcome: CliOutcome, flags: ExitFlags): Rendered {
  if (flags.json === true) return { stdout: envelopeText(jsonEnvelope(outcome)) + "\n", stderr: "" };
  const text = humanText(command, outcome);
  return exitCodeFor(command, outcome, flags) === 0 ? { stdout: text, stderr: "" } : { stdout: "", stderr: text };
}
