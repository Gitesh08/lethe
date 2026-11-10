// Help text for the CLI (Req 13.1). Pure strings; the entry point decides where they are written.
import type { CommandName } from "./args-types.js";

const GLOBALS = [
  "Global options:",
  "  --workspace <path>   workspace root (default: current directory)",
  "  --json               print exactly one JSON envelope on stdout",
  "  --now <iso>          override the clock (ISO 8601 with Z or offset)",
  "  --commit <n>         override the commit counter",
  "  --help, --version",
];

const PER_COMMAND: Readonly<Record<CommandName, string>> = {
  check: "lethe check [--scope steering-vs-specs|all] [--fail-on any|unresolvable|never] [--block]\n  Detect contradictions.",
  record: "lethe record --type task_passed|spec_cited|manual_pin [--files a,b] [--files-from-git] [--cited id,id]\n  Append a reinforcement event (estimated utility).",
  score: "lethe score [--include-specs]\n  Score every engram.",
  sleep: "lethe sleep [--apply] [--budget <n>] [--skip-gate] [--gate-runs <n>] [--block]\n  Consolidate memory (dry-run unless --apply).",
  resurrect: 'lethe resurrect --query "<id|text>" [--apply] [--block]\n  Restore archived engrams (dry-run unless --apply).',
  adopt: "lethe adopt [--apply]\n  Stamp state for engrams seen for the first time.",
  probe: "lethe probe\n  Capture a hook stdin payload to .kiro/lethe/probe/.",
  serve: "lethe serve\n  Run the MCP server on stdio.",
};

export function helpText(command?: CommandName): string {
  if (command !== undefined) return `${PER_COMMAND[command]}\n\n${GLOBALS.join("\n")}\n`;
  const all = (Object.keys(PER_COMMAND) as CommandName[]).map((c) => PER_COMMAND[c]);
  return `lethe <command> [options]\n\n${all.join("\n\n")}\n\n${GLOBALS.join("\n")}\n`;
}
