// Focused unit tests for ops/detect.ts. Refs: Req 3.2, 3.3, 3.4, 3.5
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildContext } from "../src/ops/context.js";
import { detectContradictionsOp, type DetectScope } from "../src/ops/detect.js";

const NOW = "2026-11-10T12:00:00.000Z";
const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
let dir = "";

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-detect-")));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const put = (rel: string, text: string): void => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

const snapshot = (): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" }).sort().map((p) => {
    try { return `${p}:${readFileSync(join(dir, p), "utf8")}`; } catch { return p; }
  });

async function run(scope: DetectScope) {
  const c = await buildContext({ workspacePath: dir, commit: 5, now: NOW }, { git: noGit, log: () => undefined });
  if (!c.ok) throw new Error(c.error.message);
  return detectContradictionsOp(c.value, { scope });
}

const seedSteering = (): void => {
  put(".kiro/steering/a.md", "## A\n\nUse Redux.\n");
  put(".kiro/steering/b.md", "## B\n\nUse signals.\n");
};

describe("detectContradictionsOp", () => {
  it("reports a steering-vs-steering contradiction under scope all, writing nothing", async () => {
    seedSteering();
    const before = snapshot();
    const env = await run("all");
    if (!env.ok) throw new Error(env.error.message);
    expect(env.data.count).toBe(1);
    expect(env.data.reports).toHaveLength(1);
    expect(env.data.reports[0]?.axis).toBe("state-management");
    expect(env.data.unresolvable).toBe(0);
    expect(snapshot()).toEqual(before);
  });

  it("drops steering-only pairs under steering-vs-specs", async () => {
    seedSteering();
    const env = await run("steering-vs-specs");
    if (!env.ok) throw new Error(env.error.message);
    expect(env.data.count).toBe(0);
    expect(env.data.reports).toEqual([]);
  });

  it("keeps a steering-vs-spec report under both scopes", async () => {
    put(".kiro/steering/a.md", "## A\n\nUse Redux.\n");
    put(".kiro/specs/s1/requirements.md", "## R\n\nThe app SHALL use signals. <!-- REQ-X-1 -->\n");
    for (const scope of ["all", "steering-vs-specs"] as const) {
      const env = await run(scope);
      if (!env.ok) throw new Error(env.error.message);
      expect(env.data.count).toBe(1);
      const r = env.data.reports[0];
      const ids = [r?.a.id ?? "", r?.b.id ?? ""];
      expect(ids.filter((i) => i.startsWith("spec:"))).toHaveLength(1);
    }
  });

  it("returns ONTOLOGY_INVALID_PATTERN as an error with no reports", async () => {
    seedSteering();
    const stance = { id: "x:a", label: "A", patterns: ["("], negationAware: false };
    put(".kiro/lethe/ontology.json", JSON.stringify({ version: 1, axes: [{ id: "x", description: "d", stances: [stance] }] }));
    const env = await run("all");
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe("ONTOLOGY_INVALID_PATTERN");
  });

  it("is empty for a workspace without contradictions", async () => {
    put(".kiro/steering/a.md", "## A\n\nUse ESM modules.\n");
    const env = await run("all");
    if (!env.ok) throw new Error(env.error.message);
    expect(env.data.count).toBe(0);
  });
});
