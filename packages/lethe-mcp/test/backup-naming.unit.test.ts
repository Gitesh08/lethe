// Backup directory naming and layout. Refs: Req 8.3
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BACKUP_ROOT, backupPreImages, planBackupDir } from "../src/io/backup.js";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";

let root = "";
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-bakn-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const path = (r: { ok: boolean; value?: { backupPath: string | undefined } }): string | undefined =>
  r.ok ? r.value?.backupPath : "ERR";

describe("backup naming", () => {
  it("first backup at a commit uses the bare commit number", async () => {
    const fsx = createWorkspaceFs(root);
    await fsx.writeAtomic("f.md", "x");
    expect(path(await backupPreImages(fsx, 42, ["f.md"]))).toBe(`${BACKUP_ROOT}/42`);
  });

  it("fills the lowest free suffix when a gap exists (7 and 7-3 taken -> 7-2)", async () => {
    mkdirSync(join(root, BACKUP_ROOT, "7"), { recursive: true });
    mkdirSync(join(root, BACKUP_ROOT, "7-3"));
    const fsx = createWorkspaceFs(root);
    const a = await planBackupDir(fsx, 7);
    const b = await planBackupDir(fsx, 7);
    const c = await planBackupDir(fsx, 7);
    expect([a, b, c].map((x) => x.ok && x.value)).toEqual([`${BACKUP_ROOT}/7-2`, `${BACKUP_ROOT}/7-4`, `${BACKUP_ROOT}/7-5`]);
  });

  it("does not collide across different commits (7 vs 7-2 vs 72)", async () => {
    const fsx = createWorkspaceFs(root);
    const names = [];
    for (const c of [7, 72, 7]) {
      const r = await planBackupDir(fsx, c);
      names.push(r.ok && r.value);
    }
    expect(names).toEqual([`${BACKUP_ROOT}/7`, `${BACKUP_ROOT}/72`, `${BACKUP_ROOT}/7-2`]);
  });

  it("no-op backup creates no directory, even after earlier backups exist", async () => {
    const fsx = createWorkspaceFs(root);
    const r = await backupPreImages(fsx, 3, []);
    expect(r.ok && r.value).toEqual({ backupPath: undefined, copied: [] });
    expect(existsSync(join(root, ".kiro"))).toBe(false);
    await fsx.writeAtomic("f.md", "x");
    await backupPreImages(fsx, 3, ["f.md"]);
    await backupPreImages(fsx, 3, ["gone.md"]);
    expect(existsSync(join(root, BACKUP_ROOT, "3-2"))).toBe(false);
  });

  it("preserves deeply nested relative layout byte-exact", async () => {
    const fsx = createWorkspaceFs(root);
    const rel = "a/b/c/d/e/f/g/deep file.md";
    await fsx.writeAtomic(rel, new Uint8Array([0, 1, 2, 0xff]));
    const r = await backupPreImages(fsx, 9, [rel]);
    expect(path(r)).toBe(`${BACKUP_ROOT}/9`);
    expect(new Uint8Array(readFileSync(join(root, BACKUP_ROOT, "9", rel)))).toEqual(new Uint8Array([0, 1, 2, 0xff]));
  });

  it("duplicate input paths are copied idempotently into one directory", async () => {
    const fsx = createWorkspaceFs(root);
    await fsx.writeAtomic("f.md", "same");
    const r = await backupPreImages(fsx, 5, ["f.md", "f.md"]);
    expect(r.ok && r.value.backupPath).toBe(`${BACKUP_ROOT}/5`);
    expect(readFileSync(join(root, BACKUP_ROOT, "5/f.md"), "utf8")).toBe("same");
    expect(existsSync(join(root, BACKUP_ROOT, "5-2"))).toBe(false);
  });

  it("concurrent backups at one commit get distinct directories and keep their own bytes", async () => {
    const fsx = createWorkspaceFs(root);
    const n = 6;
    for (let i = 0; i < n; i++) await fsx.writeAtomic(`f${i}.md`, `v${i}`);
    const results = await Promise.all(Array.from({ length: n }, (_, i) => backupPreImages(fsx, 11, [`f${i}.md`])));
    const dirs = results.map((r) => (r.ok ? r.value.backupPath : undefined));
    expect(new Set(dirs).size).toBe(n);
    results.forEach((r, i) => {
      const dir = r.ok ? r.value.backupPath : undefined;
      expect(dir).toBeDefined();
      expect(readFileSync(join(root, dir ?? "", `f${i}.md`), "utf8")).toBe(`v${i}`);
    });
  });
});
