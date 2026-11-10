import { err, ok } from "@lethe/core";
import { describe, expect, it } from "vitest";
import { toolError } from "../src/envelope/errors.js";
import type { WorkspaceFs } from "../src/io/workspace-fs.js";
import { parseJournal, serializeJournal } from "../src/persist/journal.js";
import { buildWritePlan, executeWritePlan, type ApplyContext } from "../src/persist/write-plan.js";
import { createMemoryFs } from "./support/memory-fs.js";

const T = ".kiro/crypt/tombstones.json";
const S = ".kiro/lethe/state.json";
const A = ".kiro/steering/a.md";
const B = ".kiro/steering/b.md";
const J = ".kiro/lethe/pending.json";
const text = (m: ReturnType<typeof createMemoryFs>, k: string): string | undefined => {
  const b = m.files.get(k);
  return b === undefined ? undefined : new TextDecoder().decode(b);
};

function setup(fail?: (rel: string) => boolean, failRestoreCopy = false) {
  const mem = createMemoryFs();
  const writes: string[] = [];
  const fs: WorkspaceFs = {
    ...mem,
    async copyTo(rel, dest) {
      if (failRestoreCopy && !dest.includes("/backup/")) return err(toolError("IO_FAILED", "copy", { path: rel }));
      return mem.copyTo(rel, dest);
    },
    async writeAtomic(rel, c) {
      if (fail?.(rel) === true) return err(toolError("IO_FAILED", "boom", { path: rel }));
      writes.push(rel);
      return mem.writeAtomic(rel, c);
    },
  };
  const ctx: ApplyContext = { fs, commit: 148, nowISO: "2026-11-09T10:00:00.000Z", pid: 1 };
  return { mem, fs, ctx, writes };
}

describe("buildWritePlan", () => {
  it("orders tombstones, steering ascending, state", () => {
    const p = buildWritePlan({
      tombstones: "t",
      steering: [{ rel: B, content: "b" }, { rel: A, content: "a" }],
      state: "s",
    });
    expect(p.map((w) => w.rel)).toEqual([T, A, B, S]);
  });
});

describe("executeWritePlan", () => {
  it("writes only differing files in order and removes the journal", async () => {
    const { mem, ctx, writes } = setup();
    mem.files.set(A, new TextEncoder().encode("same"));
    mem.files.set(B, new TextEncoder().encode("old"));
    const plan = buildWritePlan({ tombstones: "t", steering: [{ rel: A, content: "same" }, { rel: B, content: "new" }], state: "s" });
    const r = await executeWritePlan(ctx, plan);
    expect(r.ok && r.value.written).toEqual([T, B, S]);
    expect(writes.filter((w) => w !== J)).toEqual([T, B, S]);
    expect(mem.files.has(J)).toBe(false);
    expect(r.ok && r.value.backupPath).toBe(".kiro/lethe/backup/148");
    expect(text(mem, `.kiro/lethe/backup/148/${B}`)).toBe("old");
    expect(text(mem, B)).toBe("new");
  });

  it("returns early with no backup and no journal when nothing differs", async () => {
    const { mem, ctx, writes } = setup();
    mem.files.set(A, new TextEncoder().encode("x"));
    const r = await executeWritePlan(ctx, [{ rel: A, content: "x" }]);
    expect(r).toEqual(ok({ written: [] }));
    expect(writes).toEqual([]);
    expect(mem.dirs.size).toBe(0);
  });

  it("rolls back written files and deletes created ones on failure", async () => {
    const { mem, ctx } = setup((rel) => rel === S);
    mem.files.set(A, new TextEncoder().encode("old"));
    const plan = buildWritePlan({ tombstones: "t", steering: [{ rel: A, content: "new" }], state: "s" });
    const r = await executeWritePlan(ctx, plan);
    expect(!r.ok && r.error.code).toBe("IO_FAILED");
    expect(!r.ok && (r.error.detail as { applied: boolean }).applied).toBe(false);
    expect(text(mem, A)).toBe("old");
    expect(mem.files.has(T)).toBe(false);
    expect(mem.files.has(S)).toBe(false);
    expect(mem.files.has(J)).toBe(false);
  });

  it("keeps the journal and reports backupPath when restoration fails", async () => {
    let aWrites = 0;
    const { mem, ctx } = setup((rel) => (rel === A ? ++aWrites > 1 : rel === S), true);
    mem.files.set(A, new TextEncoder().encode("old"));
    const plan = buildWritePlan({ steering: [{ rel: A, content: "new" }], state: "s" });
    const r = await executeWritePlan(ctx, plan);
    expect(!r.ok && (r.error.detail as { differing: string[] }).differing).toEqual([A]);
    expect(!r.ok && (r.error.detail as { backupPath: string }).backupPath).toBe(".kiro/lethe/backup/148");
    expect(mem.files.has(J)).toBe(true);
  });
});

describe("journal", () => {
  it("round-trips", () => {
    const j = { version: 1 as const, startedAt: "t", pid: 2, backupDir: "b", files: [{ path: "p", existed: true }] };
    expect(parseJournal(serializeJournal(j))).toEqual(j);
    expect(parseJournal("{}")).toBeUndefined();
  });
});
