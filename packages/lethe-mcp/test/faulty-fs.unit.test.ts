// The faulty fs helper: failures start at call N, reads pass through, and a tripped sleep apply leaves pending.json.
// Refs: Req 8.5, Req 8.7, Req 21.7
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scrubTo } from "@lethe/core/fixtures";
import { afterEach, describe, expect, it } from "vitest";
import { stubGate } from "../src/gate/gate.js";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";
import { adoptOp } from "../src/ops/adopt.js";
import { buildContext, type ContextDeps, type RunContext } from "../src/ops/context.js";
import { sleepOp } from "../src/ops/sleep.js";
import { createFaultyFs, type FaultyFs } from "./helpers/faulty-fs.js";
import { materialiseHaunted } from "./support/haunted-ws.js";

const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function tmp(): string {
  const r = realpathSync(mkdtempSync(join(tmpdir(), "lethe-faulty-")));
  roots.push(r);
  return r;
}

describe("createFaultyFs", () => {
  it("passes calls before N, fails every mutating call from N, and keeps reads working", async () => {
    const root = tmp();
    const f = createFaultyFs(createWorkspaceFs(root), 2);
    expect((await f.fsx.writeAtomic("a.md", "one")).ok).toBe(true);
    expect(f.tripped()).toBe(false);
    for (const r of [await f.fsx.writeAtomic("b.md", "x"), await f.fsx.remove("a.md"), await f.fsx.mkdirp("d"),
      await f.fsx.mkdirExclusive("e"), await f.fsx.writeExclusive("c.md", "x"), await f.fsx.copyTo("a.md", "z.md"),
      await f.fsx.appendLine("a.md", "x")]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("IO_FAILED");
    }
    expect(f.tripped()).toBe(true);
    const text = await f.fsx.readText("a.md");
    expect(text.ok && text.value).toBe("one");
    expect(f.calls[0]).toBe("writeAtomic a.md");
    expect(f.calls).toHaveLength(8);
  });
});

describe("sleep apply through an injected faulty fs", () => {
  async function run(failFrom: number): Promise<{ root: string; faulty: FaultyFs; ok: boolean }> {
    const root = tmp();
    const repo = await materialiseHaunted(root);
    const later = scrubTo(repo, 150);
    const base: ContextDeps = { git: noGit, gate: stubGate("passed"), log: () => undefined, lock: { waitMs: 0 } };
    const mk = async (commit: number, now: string, deps: ContextDeps): Promise<RunContext> => {
      const r = await buildContext({ workspacePath: root, commit, now }, deps);
      if (!r.ok) throw new Error(r.error.message);
      return r.value;
    };
    const adopt = await adoptOp(await mk(repo.nowCommit, repo.nowISO, base), { apply: true });
    expect(adopt.ok).toBe(true);
    let faulty: FaultyFs | undefined;
    const ctx = await mk(later.nowCommit, later.nowISO, {
      ...base,
      fsx: (r) => (faulty = createFaultyFs(createWorkspaceFs(r), failFrom)).fsx,
    });
    const res = await sleepOp(ctx, { apply: true, skipGate: false, gateRuns: 20 });
    if (faulty === undefined) throw new Error("fsx factory was not used");
    return { root, faulty, ok: res.ok };
  }

  it("leaves pending.json behind when tripped right after the journal is written", async () => {
    const clean = await run(Number.MAX_SAFE_INTEGER);
    expect(clean.ok).toBe(true);
    expect(clean.faulty.tripped()).toBe(false);
    expect(existsSync(join(clean.root, ".kiro/lethe/pending.json"))).toBe(false);

    const journalPos = clean.faulty.calls.findIndex((c) => c === "writeAtomic .kiro/lethe/pending.json") + 1;
    expect(journalPos).toBeGreaterThan(0);
    const crashed = await run(journalPos + 1);
    expect(crashed.faulty.tripped()).toBe(true);
    expect(crashed.ok).toBe(false);
    expect(existsSync(join(crashed.root, ".kiro/lethe/pending.json"))).toBe(true);
  }, 60_000);
});
