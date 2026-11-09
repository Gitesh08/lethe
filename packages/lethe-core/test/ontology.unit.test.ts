import { describe, it, expect } from "vitest";
import { DEFAULT_AXES } from "../src/contradiction/default-ontology.js";

const EXPECTED_IDS = [
  "state-management", "css-approach", "framework", "package-manager",
  "test-runner", "module-system", "error-handling", "typing-strictness",
  "component-model", "data-fetching", "naming-convention", "file-size-policy",
];

const POSITIVE: ReadonlyArray<{ stanceId: string; sentence: string }> = [
  { stanceId: "state:rxjs-subjects", sentence: "Use RxJS BehaviorSubject for state." },
  { stanceId: "state:signals", sentence: "Use signals for state." },
  { stanceId: "state:redux", sentence: "Manage state with Redux Toolkit." },
  { stanceId: "state:zustand", sentence: "Prefer Zustand stores." },
  { stanceId: "state:context", sentence: "Share state with React Context." },
  { stanceId: "css:tailwind", sentence: "Use Tailwind for styling." },
  { stanceId: "css:pure-css", sentence: "Use pure CSS, no frameworks." },
  { stanceId: "css:css-in-js", sentence: "Style with styled-components." },
  { stanceId: "css:css-modules", sentence: "Use CSS Modules per component." },
  { stanceId: "fw:react", sentence: "The app is built with React." },
  { stanceId: "fw:angular", sentence: "The app is built with Angular." },
  { stanceId: "fw:vue", sentence: "The app is built with Vue." },
  { stanceId: "fw:svelte", sentence: "The app is built with Svelte." },
  { stanceId: "pm:npm", sentence: "Always run npm install." },
  { stanceId: "pm:yarn", sentence: "Always run yarn install." },
  { stanceId: "pm:pnpm", sentence: "Always run pnpm install." },
  { stanceId: "pm:bun", sentence: "Always run bun install." },
  { stanceId: "test:jest", sentence: "Write tests with Jest." },
  { stanceId: "test:vitest", sentence: "Write tests with Vitest." },
  { stanceId: "test:mocha", sentence: "Write tests with Mocha." },
  { stanceId: "mod:esm", sentence: "Use ESM only." },
  { stanceId: "mod:commonjs", sentence: "Use CommonJS require() calls." },
  { stanceId: "err:throw-exceptions", sentence: "Throw errors for failures." },
  { stanceId: "err:result-types", sentence: "Return Result types instead." },
  { stanceId: "typing:strict-ts", sentence: "Enable strict mode everywhere." },
  { stanceId: "typing:loose-ts", sentence: "It is fine to use as any here." },
  { stanceId: "comp:server-components", sentence: "Default to Server Components." },
  { stanceId: "comp:client-components", sentence: "Default to Client Components." },
  { stanceId: "fetch:react-query", sentence: "Fetch with React Query." },
  { stanceId: "fetch:swr", sentence: "Fetch with SWR." },
  { stanceId: "fetch:server-fetch", sentence: "Use server-side fetch in pages." },
  { stanceId: "name:camel-case", sentence: "Name files in camelCase." },
  { stanceId: "name:kebab-case", sentence: "Name files in kebab-case." },
  { stanceId: "name:pascal-case", sentence: "Name files in PascalCase." },
  { stanceId: "size:small-files", sentence: "Keep small files, 200 lines per file." },
  { stanceId: "size:large-files", sentence: "Large files are acceptable." },
];

// Sentence must NOT match any of the listed stances (same axis, unrelated).
const NEGATIVE: ReadonlyArray<{ sentence: string; notStances: readonly string[] }> = [
  { sentence: "Use signals for state.", notStances: ["state:rxjs-subjects", "state:redux", "state:zustand", "state:context"] },
  { sentence: "Use RxJS BehaviorSubject for state.", notStances: ["state:signals", "state:redux", "state:zustand", "state:context"] },
  { sentence: "Use Tailwind for styling.", notStances: ["css:pure-css", "css:css-in-js", "css:css-modules"] },
  { sentence: "Use pure CSS, no frameworks.", notStances: ["css:tailwind", "css:css-in-js", "css:css-modules"] },
  { sentence: "Use CSS Modules per component.", notStances: ["css:pure-css", "css:tailwind", "css:css-in-js"] },
  { sentence: "The app is built with React.", notStances: ["fw:angular", "fw:vue", "fw:svelte"] },
  { sentence: "Always run pnpm install.", notStances: ["pm:npm", "pm:yarn", "pm:bun"] },
  { sentence: "Write tests with Vitest.", notStances: ["test:jest", "test:mocha"] },
  { sentence: "Use ESM only.", notStances: ["mod:commonjs"] },
  { sentence: "Return Result types instead.", notStances: ["err:throw-exceptions"] },
  { sentence: "Enable strict mode everywhere.", notStances: ["typing:loose-ts"] },
  { sentence: "Default to Server Components.", notStances: ["comp:client-components", "fw:react"] },
  { sentence: "Fetch with React Query.", notStances: ["fetch:swr", "fetch:server-fetch", "fw:react"] },
  { sentence: "Name files in kebab-case.", notStances: ["name:camel-case", "name:pascal-case"] },
  { sentence: "Keep small files, 200 lines per file.", notStances: ["size:large-files"] },
];

const allStances = DEFAULT_AXES.flatMap((a) => a.stances);

function matches(stanceId: string, text: string): boolean {
  const s = allStances.find((x) => x.id === stanceId);
  if (s === undefined) throw new Error(`unknown stance ${stanceId}`);
  return s.patterns.some((p) => new RegExp(p, "i").test(text));
}

describe("default ontology", () => {
  it("has exactly the 12 expected axes, each with >= 2 stances", () => {
    expect(DEFAULT_AXES.map((a) => a.id)).toEqual(EXPECTED_IDS);
    for (const a of DEFAULT_AXES) expect(a.stances.length).toBeGreaterThanOrEqual(2);
  });

  it("has globally unique stance ids and compilable patterns", () => {
    const ids = allStances.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of allStances) {
      expect(s.patterns.length).toBeGreaterThan(0);
      for (const p of s.patterns) expect(() => new RegExp(p, "i")).not.toThrow();
    }
  });

  it("covers every stance with a positive example", () => {
    expect(new Set(POSITIVE.map((p) => p.stanceId))).toEqual(new Set(allStances.map((s) => s.id)));
  });

  it.each(POSITIVE)("$stanceId matches: $sentence", ({ stanceId, sentence }) => {
    expect(matches(stanceId, sentence)).toBe(true);
  });

  it.each(NEGATIVE)("does not cross-match: $sentence", ({ sentence, notStances }) => {
    for (const id of notStances) expect(matches(id, sentence), id).toBe(false);
  });

  it("makes the PRD demo pairs detectable as distinct stances", () => {
    expect(matches("state:rxjs-subjects", "use RxJS BehaviorSubject for state")).toBe(true);
    expect(matches("state:signals", "use signals")).toBe(true);
    expect(matches("css:tailwind", "no Tailwind")).toBe(true);
  });

  // The ReDoS timing bound lives in ontology.perf.test.ts (runs serially).
});
