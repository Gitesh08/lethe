// Derives SpecInvariant values from .kiro/specs/<name>/ files (Req 10.3, REQ-DEC-4). Pure: no IO.
import { deriveSpecStances, type CompiledOntology, type SpecInvariant } from "@lethe/core";
import { SPECS_DIR } from "./steering.js";

const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const REQ_ID = /REQ-[A-Z]+-[0-9]+/g;
const OPEN_TASK = /^\s*- \[[ -]\]/m;
const SHALL = /\bSHALL\b/;
const BLANK_LINE = /\r?\n[ \t]*\r?\n/;

/** Paragraphs (blank-line separated) of requirements text that contain the word SHALL. */
export function normativeText(requirements: string): string {
  return requirements
    .split(BLANK_LINE)
    .filter((p) => SHALL.test(p))
    .join("\n\n");
}

/** Sorted unique REQ-* ids. */
export function requirementIdsOf(requirements: string): readonly string[] {
  return [...new Set(requirements.match(REQ_ID) ?? [])].sort(byCodeUnits);
}

/** True when tasks.md is absent or has an open (`[ ]` or `[-]`) checkbox line. */
export function hasOpenTasks(tasks: string | undefined): boolean {
  return tasks === undefined || OPEN_TASK.test(tasks);
}

/** Spec name -> { requirements, tasks } for files directly inside `.kiro/specs/<name>/`. Deeper files are ignored. */
function groupSpecs(specFiles: ReadonlyMap<string, string>): ReadonlyMap<string, { requirements?: string; tasks?: string }> {
  const prefix = `${SPECS_DIR}/`;
  const groups = new Map<string, { requirements?: string; tasks?: string }>();
  for (const [path, text] of specFiles) {
    if (!path.startsWith(prefix)) continue;
    const parts = path.slice(prefix.length).split("/");
    const name = parts[0];
    if (name === undefined || name === "" || parts.length < 2) continue;
    const g = groups.get(name) ?? {};
    groups.set(name, g);
    if (parts.length !== 2) continue;
    if (parts[1] === "requirements.md") g.requirements = text;
    else if (parts[1] === "tasks.md") g.tasks = text;
  }
  return groups;
}

/**
 * One SpecInvariant per spec directory, ascending by name. `activeSpecs`, when defined, decides
 * `active` by membership; otherwise `tasks.md` decides. Stances come only from core's deriveSpecStances.
 */
export function deriveSpecs(
  specFiles: ReadonlyMap<string, string>,
  compiled: CompiledOntology,
  activeSpecs: readonly string[] | undefined,
): readonly SpecInvariant[] {
  const groups = groupSpecs(specFiles);
  return [...groups.keys()].sort(byCodeUnits).map((specName): SpecInvariant => {
    const g = groups.get(specName) ?? {};
    const requirements = g.requirements ?? "";
    return {
      specName,
      active: activeSpecs !== undefined ? activeSpecs.includes(specName) : hasOpenTasks(g.tasks),
      requirementIds: requirementIdsOf(requirements),
      stances: deriveSpecStances(normativeText(requirements), compiled),
    };
  });
}
