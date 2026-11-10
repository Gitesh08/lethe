// Failure injection at every mutating step of executeWritePlan (Req 8.5).
import { err } from "@lethe/core";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toolError } from "../src/envelope/errors.js";
import type { WorkspaceFs } from "../src/io/workspace-fs.js";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";
import { JOURNAL_PATH } from "../src/persist/journal.js";
import { buildWritePlan, executeWritePlan, type ApplyContext } from "../src/persist/write-plan.js";
import { createMemoryFs } from "./support/memory-fs.js";

const T = ".kiro/crypt/tombstones.json";
const S = ".kiro/lethe/state.json";
const A = ".kiro/steering/a.md";
const B = ".kiro/steering/b.md";
const BACKUP = ".kiro/lethe/backup/148";
const ORIGINAL: Readonly<Record<string, string>> = { [T]: "t0", [A]: "a0", [S]: "s0" };
const plan = buildWritePlan({
  tombstones: "t1",
  steering: [{ rel: A, content: "a1" }, { rel: B, content: "b1" }],
  state: "s1",
});

interface Call {
  readonly op: string;
  readonly rel: string;
}

/** Wraps a fs; every mutating call is logged and the call at index `failAt` fails once. */
function inject(base: WorkspaceFs, failAt: number, extra?: (c: Call) => boolean) {
  const calls: Call[] = [];
  const gate = (op: string, rel: string): boolean => {
    const c = { op, rel };
    const idx = calls.push(c) - 1;
    return idx === failAt || extra?.(c) === true;
  };
  const bad = (rel: string) => err(toolError("IO_FAILED", "injected", { path: rel }));
  const fs: WorkspaceFs = {
    ...base,
    async mkdirp(rel) { return gate("mkdirp", rel) ? bad(rel) : base.mkdirp(rel); },
    async mkdirExclusive(rel) { return gate("mkdirExclusive", rel) ? bad(rel) : base.mkdirExclusive(rel); },
    async copyTo(rel, dest) { return gate("copyTo", dest) ? bad(rel) : base.copyTo(rel, dest); },
    async writeAtomic(rel, c) { return gate("writeAtomic", rel) ? bad(rel) : base.writeAtomic(rel, c); },
    async remove(rel) { return gate("remove", rel) ? bad(rel) : base.remove(rel); },
  };
  const ctx: ApplyContext = { fs, commit: 148, nowISO: "2026-11-09T10:00:00.000Z", pid: 1 };
  return { fs, ctx, calls };
}

function seeded() {
  const mem = createMemoryFs();
  for (const [k, v] of Object.entries(ORIGINAL)) mem.files.set(k, new TextEncoder().encode(v));
  return mem;
}
const textOf = (m: ReturnType<typeof createMemoryFs>, k: string): string | undefined => {
  const b = m.files.get(k);
  return b === undefined ? undefined : new TextDecoder().decode(b);
};

// Record the successful call sequence first so the parameterisation tracks the executor's real order.
const recorded = await (async () => {
  const mem = seeded();
  const { ctx, calls } = inject(mem, -1);
  const r = await executeWritePlan(ctx, plan);
  if (!r.ok) throw new Error("baseline run must succeed");
  return calls;
})();
const firstTarget = recorded.findIndex((c) => c.op === "writeAtomic" && c.rel === T);
const cases = recorded.map((c, i) => ({ i, label: `${i}: ${c.op} ${c.rel}`, preTargets: i < firstTarget }));

describe("executeWritePlan failure injection", () => {
  it("records the expected write order", () => {
    expect(recorded.map((c) => c.op)).toEqual([
      "mkdirp", "mkdirExclusive", "copyTo", "copyTo", "copyTo",
      "writeAtomic", "writeAtomic", "writeAtomic", "writeAtomic", "writeAtomic", "remove",
    ]);
    expect(recorded[5]?.rel).toBe(JOURNAL_PATH);
    expect(recorded.slice(6, 10).map((c) => c.rel)).toEqual([T, A, B, S]);
  });

  it.each(cases)("fails at step $label and restores everything", async ({ i, preTargets }) => {
    const mem = seeded();
    const { ctx } = inject(mem, i);
    const r = await executeWritePlan(ctx, plan);
    expect(!r.ok && r.error.code).toBe("IO_FAILED");
    if (!r.ok && !preTargets) {
      expect((r.error.detail as { applied: boolean }).applied).toBe(false);
      expect((r.error.detail as { differing?: unknown }).differing).toBeUndefined();
    }
    if (!r.ok && preTargets) expect(r.error.message).toBe("injected");
    for (const [k, v] of Object.entries(ORIGINAL)) expect(textOf(mem, k)).toBe(v);
    expect(mem.files.has(B)).toBe(false);
    expect(mem.files.has(JOURNAL_PATH)).toBe(false);
  });

  it("lists stuck files and keeps the journal when rollback also fails", async () => {
    const mem = seeded();
    const seen = new Map<string, number>();
    const stuck = (c: Call): boolean => {
      if (c.op === "copyTo") return !c.rel.startsWith(BACKUP);
      if (c.op !== "writeAtomic" || c.rel === JOURNAL_PATH) return false;
      const n = (seen.get(c.rel) ?? 0) + 1;
      seen.set(c.rel, n);
      return c.rel === S || (n > 1 && (c.rel === A || c.rel === T));
    };
    const { ctx } = inject(mem, -1, stuck);
    const r = await executeWritePlan(ctx, plan);
    expect(!r.ok && r.error.code).toBe("IO_FAILED");
    const d = !r.ok ? (r.error.detail as { differing: string[]; backupPath: string }) : undefined;
    expect(d?.differing).toEqual([T, A, S]);
    expect(d?.backupPath).toBe(BACKUP);
    expect(mem.files.has(JOURNAL_PATH)).toBe(true);
    expect(textOf(mem, S)).toBe("s0");
    expect(mem.files.has(B)).toBe(false);
  });

  it("restores a real workspace after a mid-apply failure", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "lethe-wp-")));
    try {
      const real = createWorkspaceFs(root);
      for (const [k, v] of Object.entries(ORIGINAL)) expect((await real.writeAtomic(k, v)).ok).toBe(true);
      const { ctx } = inject(real, firstTarget + 2);
      const r = await executeWritePlan(ctx, plan);
      expect(!r.ok && r.error.code).toBe("IO_FAILED");
      for (const [k, v] of Object.entries(ORIGINAL)) {
        const cur = await real.readText(k);
        expect(cur.ok && cur.value).toBe(v);
      }
      for (const gone of [B, JOURNAL_PATH]) {
        const cur = await real.readText(gone);
        expect(cur.ok && cur.value).toBeUndefined();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
