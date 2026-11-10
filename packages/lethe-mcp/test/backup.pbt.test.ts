// Property: N backups at one commit yield distinct directories and none is overwritten. Refs: Req 8.3
// Runs on an in-memory WorkspaceFs (faithful mkdirExclusive/copyTo/readBytes) so 1,000 runs stay fast.
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { backupPreImages } from "../src/io/backup.js";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";
import { createMemoryFs } from "./support/memory-fs.js";
import { runAsyncProperty } from "./support/pbt-runner.js";

const content = fc.string({ maxLength: 12 });
const contents = fc.array(content, { minLength: 1, maxLength: 8 });
const dec = new TextDecoder();

describe("P-backup: backup directory names", () => {
  it("sequential backups at one commit: distinct dirs, each holds the bytes current at its call", async () => {
    await runAsyncProperty(
      "backup-sequential",
      fc.asyncProperty(fc.nat(100_000), contents, async (commit, versions) => {
        const fsx = createMemoryFs();
        const dirs: string[] = [];
        for (const v of versions) {
          await fsx.writeAtomic("a/f.md", v);
          const r = await backupPreImages(fsx, commit, ["a/f.md"]);
          if (!r.ok || r.value.backupPath === undefined) return false;
          dirs.push(r.value.backupPath);
        }
        if (new Set(dirs).size !== dirs.length) return false;
        return dirs.every((d, i) => dec.decode(fsx.files.get(`${d}/a/f.md`)) === versions[i]);
      }),
    );
  });

  it("concurrent backups at one commit: distinct dirs, each holds its own file and shared bytes", async () => {
    await runAsyncProperty(
      "backup-concurrent",
      fc.asyncProperty(fc.nat(100_000), contents, content, async (commit, own, shared) => {
        const fsx = createMemoryFs();
        await fsx.writeAtomic("shared.md", shared);
        for (let i = 0; i < own.length; i++) await fsx.writeAtomic(`f${i}.md`, own[i] ?? "");
        const rs = await Promise.all(own.map((_, i) => backupPreImages(fsx, commit, [`f${i}.md`, "shared.md"])));
        const dirs = rs.map((r) => (r.ok ? r.value.backupPath : undefined));
        if (dirs.some((d) => d === undefined) || new Set(dirs).size !== dirs.length) return false;
        return dirs.every((d, i) => {
          const files = [...fsx.files.keys()].filter((k) => k.startsWith(`${d}/`));
          return (
            files.length === 2 &&
            dec.decode(fsx.files.get(`${d}/f${i}.md`)) === own[i] &&
            dec.decode(fsx.files.get(`${d}/shared.md`)) === shared
          );
        });
      }),
    );
  });

  it("real filesystem example: three sequential backups keep their own bytes", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-bakp-")));
    try {
      const fsx = createWorkspaceFs(root);
      const dirs: string[] = [];
      for (const v of ["one", "two", "three"]) {
        await fsx.writeAtomic("f.md", v);
        const r = await backupPreImages(fsx, 1, ["f.md"]);
        dirs.push(r.ok ? (r.value.backupPath ?? "") : "");
      }
      expect(new Set(dirs).size).toBe(3);
      expect(dirs.map((d) => readFileSync(join(root, d, "f.md"), "utf8"))).toEqual(["one", "two", "three"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
