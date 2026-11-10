// Crash recovery (Req 8.10), tombstone refusal (Req 8.6), and no-op apply (Req 8.7, 8.3).
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspaceFs, type WorkspaceFs } from "../src/io/workspace-fs.js";
import { loadWorkspace } from "../src/load/workspace.js";
import { loadTombstones } from "../src/load/tombstone-file.js";
import { JOURNAL_PATH, serializeJournal } from "../src/persist/journal.js";
import { recoverInterruptedApply } from "../src/persist/recover.js";
import { TOMBSTONES_PATH, STATE_PATH, executeWritePlan, type ApplyContext } from "../src/persist/write-plan.js";
import { createMemoryFs } from "./support/memory-fs.js";

const A = ".kiro/steering/a.md";
const B = ".kiro/steering/b.md";
const BACKUP = ".kiro/lethe/backup/148";
const ORIGINAL: Readonly<Record<string, string>> = { [TOMBSTONES_PATH]: "t0\r\n", [A]: "\uFEFFa0\r\n", [STATE_PATH]: "s0" };
const ORDER = [TOMBSTONES_PATH, A, B, STATE_PATH];
const NEW_TEXT: Readonly<Record<string, string>> = { [TOMBSTONES_PATH]: "t1", [A]: "a1", [B]: "b1", [STATE_PATH]: "s1" };
const journal = serializeJournal({
  version: 1,
  startedAt: "2026-11-09T10:00:00.000Z",
  pid: 1,
  backupDir: BACKUP,
  files: ORDER.map((path) => ({ path, existed: path !== B })),
});

/** Journal + backup of the originals, then `k` targets rewritten and target k half written (a crash at position k). */
async function crashAt(fsx: WorkspaceFs, k: number): Promise<void> {
  for (const [p, v] of Object.entries(ORIGINAL)) {
    await fsx.writeAtomic(p, v);
    await fsx.writeAtomic(`${BACKUP}/${p}`, v);
  }
  await fsx.writeAtomic(JOURNAL_PATH, journal);
  for (const [i, p] of ORDER.entries()) {
    if (i < k) await fsx.writeAtomic(p, NEW_TEXT[p] ?? "");
    if (i === k) await fsx.writeAtomic(p, (NEW_TEXT[p] ?? "").slice(0, 1));
  }
}

async function expectRestored(fsx: WorkspaceFs): Promise<void> {
  for (const [p, v] of Object.entries(ORIGINAL)) {
    const cur = await fsx.readBytes(p);
    expect(cur.ok && cur.value !== undefined ? Array.from(cur.value) : undefined).toEqual(
      Array.from(new TextEncoder().encode(v)),
    );
  }
  for (const gone of [B, JOURNAL_PATH]) {
    const cur = await fsx.readBytes(gone);
    expect(cur.ok && cur.value).toBeUndefined();
  }
}

async function withRoot<T>(fn: (root: string, fsx: WorkspaceFs) => Promise<T>): Promise<T> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lethe-rec-")));
  try {
    return await fn(root, createWorkspaceFs(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("recoverInterruptedApply", () => {
  it("is a no-op without a journal", async () => {
    const mem = createMemoryFs();
    const r = await recoverInterruptedApply(mem);
    expect(r.ok && r.value).toBeUndefined();
    expect(mem.files.size).toBe(0);
  });

  it.each([0, 1, 2, 3])("restores byte-exact after a crash at target %i (memory fs)", async (k) => {
    const mem = createMemoryFs();
    await crashAt(mem, k);
    const r = await recoverInterruptedApply(mem);
    expect(r.ok && r.value?.code).toBe("INTERRUPTED_APPLY_RECOVERED");
    await expectRestored(mem);
    const again = await recoverInterruptedApply(mem);
    expect(again.ok && again.value).toBeUndefined();
  });

  it("restores a real workspace and is idempotent", async () => {
    await withRoot(async (_root, fsx) => {
      await crashAt(fsx, 2);
      const r = await recoverInterruptedApply(fsx);
      expect(r.ok && r.value?.code).toBe("INTERRUPTED_APPLY_RECOVERED");
      await expectRestored(fsx);
      const again = await recoverInterruptedApply(fsx);
      expect(again.ok && again.value).toBeUndefined();
    });
  });

  it("refuses an invalid journal and keeps it", async () => {
    const mem = createMemoryFs();
    mem.files.set(JOURNAL_PATH, new TextEncoder().encode("{nope"));
    const r = await recoverInterruptedApply(mem);
    expect(!r.ok && r.error.code).toBe("IO_FAILED");
    expect(mem.files.has(JOURNAL_PATH)).toBe(true);
  });

  it("refuses when a pre-image is missing, touching nothing", async () => {
    const mem = createMemoryFs();
    await crashAt(mem, 1);
    mem.files.delete(`${BACKUP}/${A}`);
    const before = new Map(mem.files);
    const r = await recoverInterruptedApply(mem);
    expect(!r.ok && r.error.code).toBe("IO_FAILED");
    expect(mem.files).toEqual(before);
  });
});

describe("malformed tombstones.json", () => {
  it("yields CONFIG_INVALID and the bytes are left untouched", async () => {
    await withRoot(async (_root, fsx) => {
      const bad = '{"version":1,"tombstones":[{"nope":';
      await fsx.writeAtomic(TOMBSTONES_PATH, bad);
      const direct = await loadTombstones(fsx);
      expect(!direct.ok && direct.error.code).toBe("CONFIG_INVALID");
      const ws = await loadWorkspace(fsx, { includeSpecs: false, needTombstones: true });
      expect(!ws.ok && ws.error.code).toBe("CONFIG_INVALID");
      const after = await fsx.readText(TOMBSTONES_PATH);
      expect(after.ok && after.value).toBe(bad);
    });
  });
});

describe("no-op apply", () => {
  it("creates no backup, no journal, and leaves tombstones.json alone", async () => {
    await withRoot(async (root, fsx) => {
      const tomb = '{ "version": 1, "tombstones": [] }\n';
      await fsx.writeAtomic(TOMBSTONES_PATH, tomb);
      await fsx.writeAtomic(A, "same");
      const ctx: ApplyContext = { fs: fsx, commit: 148, nowISO: "2026-11-09T10:00:00.000Z", pid: 1 };
      const r = await executeWritePlan(ctx, [{ rel: TOMBSTONES_PATH, content: tomb }, { rel: A, content: "same" }]);
      expect(r.ok && r.value.written).toEqual([]);
      expect(r.ok && r.value.backupPath).toBeUndefined();
      const lethe = await readdir(join(root, ".kiro")).catch(() => [] as string[]);
      expect(lethe).not.toContain("lethe");
      const j = await fsx.readText(JOURNAL_PATH);
      expect(j.ok && j.value).toBeUndefined();
      const t = await fsx.readText(TOMBSTONES_PATH);
      expect(t.ok && t.value).toBe(tomb);
    });
  });
});
