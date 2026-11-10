// detectContradictionsOp over the haunted fixture. Refs: Req 3.2, Req 3.3, Req 3.4
// Expected reports are computed independently with core: parseDocument -> score -> detectContradictions.
// The fixture is materialised with NO ledger and NO state.json, so the op's checkpoint view reduces to plain
// core score() with empty states/ledger at the same nowCommit/nowISO (no checkpoint replication needed).
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DEFAULT_AXES, detectContradictions, parseDocument, score,
  type ContradictionReport, type EngramNode,
} from "@lethe/core";
import { DEMO_SEED, generateHauntedRepo } from "@lethe/core/fixtures";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nodeAtomicFsOps, type WorkspaceFsOptions } from "../src/io/workspace-fs.js";
import { buildContext } from "../src/ops/context.js";
import { detectContradictionsOp, type DetectScope } from "../src/ops/detect.js";

const NOW = "2026-11-10T12:00:00.000Z";
const COMMIT = 200;
const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
const repo = generateHauntedRepo(DEMO_SEED);
const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const isSpec = (id: string): boolean => id.startsWith("spec:");
const specCount = (r: ContradictionReport): number => Number(isSpec(r.a.id)) + Number(isSpec(r.b.id));

const SENTENCE: Record<string, string> = {
  "mod:esm": "THE code SHALL use ESM modules.",
  "err:result-types": "THE engine SHALL return Result types.",
  "typing:strict-ts": "THE code SHALL use strict TypeScript.",
  "state:signals": "THE UI SHALL use signals.",
  "css:pure-css": "THE UI SHALL use pure CSS.",
};

let dir = "";
const put = (rel: string, text: string): void => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

// Steering files and specs only: no ledger.jsonl, no state.json.
function materialise(): void {
  for (const [path, text] of repo.workspace.files) put(path, text);
  for (const spec of repo.specs) {
    const ids = spec.requirementIds.map((id) => `<!-- ${id} -->`).join(" ");
    const lines = spec.stances.map((s) => SENTENCE[s] ?? `UNMAPPED ${s}`).join("\n\n");
    put(`.kiro/specs/${spec.specName}/requirements.md`, `# ${spec.specName}\n\n${ids}\n\n${lines}\n`);
    put(`.kiro/specs/${spec.specName}/tasks.md`, "- [x] 1. done\n- [ ] 2. open\n");
  }
}

function expectedReports(): ReadonlyArray<ContradictionReport> {
  const engrams: EngramNode[] = [];
  for (const path of [...repo.workspace.files.keys()].sort(byCodeUnits)) {
    if (!path.startsWith(".kiro/steering/")) continue;
    const parsed = parseDocument(path, repo.workspace.files.get(path) ?? "", repo.cfg);
    if (!parsed.ok) throw new Error(`fixture file ${path} does not parse`);
    engrams.push(...parsed.value.engrams);
  }
  const scored = score({ engrams, states: [], specs: repo.specs, ledger: [], nowCommit: COMMIT, nowISO: NOW, cfg: repo.cfg });
  const found = detectContradictions(scored, repo.specs, DEFAULT_AXES);
  if (!found.ok) throw new Error(found.error.message);
  return found.value;
}

// Full-workspace snapshot: relative path -> bytes (hex) + mtime.
function snapshot(): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).sort().map((p) => {
    const st = statSync(join(dir, p));
    return st.isDirectory() ? `${p}/@${st.mtimeMs}` : `${p}:${readFileSync(join(dir, p)).toString("hex")}@${st.mtimeMs}`;
  });
}

async function run(scope: DetectScope, fsOptions?: WorkspaceFsOptions) {
  const c = await buildContext(
    { workspacePath: dir, commit: COMMIT, now: NOW },
    { git: noGit, log: () => undefined, ...(fsOptions === undefined ? {} : { fsOptions }) },
  );
  if (!c.ok) throw new Error(c.error.message);
  return detectContradictionsOp(c.value, { scope });
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-detect-haunted-")));
  materialise();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("detectContradictionsOp over the haunted repo", () => {
  it("scope all equals core detectContradictions output, in order", async () => {
    const want = expectedReports();
    expect(want.length).toBeGreaterThan(0);
    const env = await run("all");
    if (!env.ok) throw new Error(env.error.message);
    expect(env.data.reports).toEqual(want);
    expect(env.data.count).toBe(want.length);
    expect(env.data.unresolvable).toBe(want.filter((r) => r.resolution.kind === "unresolvable").length);
  });

  it("steering-vs-specs keeps exactly the pairs with one spec id; the complement is non-empty", async () => {
    const want = expectedReports();
    const mixed = want.filter((r) => specCount(r) === 1);
    const complement = want.filter((r) => specCount(r) !== 1);
    expect(mixed.length).toBeGreaterThan(0);
    expect(complement.length).toBeGreaterThan(0);
    const env = await run("steering-vs-specs");
    if (!env.ok) throw new Error(env.error.message);
    expect(env.data.reports).toEqual(mixed);
    expect(env.data.count).toBe(mixed.length);
    expect(env.data.count).toBeLessThan(want.length);
    for (const r of env.data.reports) expect(specCount(r)).toBe(1);
  });

  it("an invalid ontology pattern returns ONTOLOGY_INVALID_PATTERN and no reports", async () => {
    const stance = { id: "x:a", label: "A", patterns: ["("], negationAware: false };
    put(".kiro/lethe/ontology.json", JSON.stringify({ version: 1, axes: [{ id: "x", description: "d", stances: [stance] }] }));
    const env = await run("all");
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.code).toBe("ONTOLOGY_INVALID_PATTERN");
    expect("data" in env).toBe(false);
  });

  it("performs no filesystem write", async () => {
    const calls: string[] = [];
    const ops = new Proxy(nodeAtomicFsOps, {
      get(target, prop, receiver) {
        const v: unknown = Reflect.get(target, prop, receiver);
        if (typeof v !== "function") return v;
        return (...args: unknown[]) => {
          calls.push(String(prop));
          return (v as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const before = snapshot();
    for (const scope of ["all", "steering-vs-specs"] as const) {
      const env = await run(scope, { ops });
      expect(env.ok).toBe(true);
    }
    expect(calls).toEqual([]);
    expect(snapshot()).toEqual(before);
  });
});
