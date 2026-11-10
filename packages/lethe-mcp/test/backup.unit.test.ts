// Happy-path tests for pre-image backups. Refs: Req 8.3
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupPreImages } from "../src/io/backup.js";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";

let root = "";
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-bak-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0x00, 0xff]);

describe("backupPreImages", () => {
  it("copies byte-exact pre-images preserving layout, skipping missing files", async () => {
    const fsx = createWorkspaceFs(root);
    await fsx.writeAtomic(".kiro/steering/a.md", bytes);
    await fsx.writeAtomic(".kiro/lethe/state.json", "{}");
    const r = await backupPreImages(fsx, 148, [".kiro/steering/a.md", ".kiro/crypt/tombstones.json", ".kiro/lethe/state.json"]);
    expect(r.ok && r.value.backupPath).toBe(".kiro/lethe/backup/148");
    expect(r.ok && r.value.copied).toEqual([".kiro/steering/a.md", ".kiro/lethe/state.json"]);
    const copy = readFileSync(join(root, ".kiro/lethe/backup/148/.kiro/steering/a.md"));
    expect(new Uint8Array(copy)).toEqual(bytes);
    expect(existsSync(join(root, ".kiro/lethe/backup/148/.kiro/crypt/tombstones.json"))).toBe(false);
  });

  it("uses -2, -3 suffixes and never overwrites an earlier backup", async () => {
    const fsx = createWorkspaceFs(root);
    await fsx.writeAtomic("f.md", "v1");
    const a = await backupPreImages(fsx, 7, ["f.md"]);
    await fsx.writeAtomic("f.md", "v2");
    const b = await backupPreImages(fsx, 7, ["f.md"]);
    await fsx.writeAtomic("f.md", "v3");
    const c = await backupPreImages(fsx, 7, ["f.md"]);
    expect([a, b, c].map((x) => x.ok && x.value.backupPath)).toEqual([
      ".kiro/lethe/backup/7",
      ".kiro/lethe/backup/7-2",
      ".kiro/lethe/backup/7-3",
    ]);
    expect(readFileSync(join(root, ".kiro/lethe/backup/7/f.md"), "utf8")).toBe("v1");
    expect(readFileSync(join(root, ".kiro/lethe/backup/7-3/f.md"), "utf8")).toBe("v3");
  });

  it("creates no directory when no file has a pre-image", async () => {
    const r = await backupPreImages(createWorkspaceFs(root), 1, ["missing.md"]);
    expect(r.ok && r.value).toEqual({ backupPath: undefined, copied: [] });
    expect(existsSync(join(root, ".kiro"))).toBe(false);
  });

  it("rejects paths escaping the workspace", async () => {
    const r = await backupPreImages(createWorkspaceFs(root), 1, ["../outside.md"]);
    expect(r.ok).toBe(false);
  });
});
