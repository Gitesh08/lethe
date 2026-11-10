// Smoke tests for the guarded workspace fs and atomic writer (happy path). Refs: Req 7.1, 8.1, 8.2
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";

let root = "";
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-wfs-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("createWorkspaceFs", () => {
  it("writes exact bytes (CRLF, BOM, no trailing newline), creates parents, leaves no temp file", async () => {
    const fsx = createWorkspaceFs(root);
    const text = "\uFEFFa\r\nb\r\nc";
    expect((await fsx.writeAtomic("x/y/f.md", text)).ok).toBe(true);
    expect(readFileSync(join(root, "x", "y", "f.md"))).toEqual(Buffer.from(text, "utf8"));
    expect(readdirSync(join(root, "x", "y"))).toEqual(["f.md"]);
  });

  it("replaces an existing file and round-trips through readText/readBytes", async () => {
    const fsx = createWorkspaceFs(root);
    await fsx.writeAtomic("f.md", "one");
    await fsx.writeAtomic("f.md", new Uint8Array([0xef, 0xbb, 0xbf, 0x41]));
    const t = await fsx.readText("f.md");
    expect(t.ok && t.value).toBe("\uFEFFA");
    const b = await fsx.readBytes("f.md");
    expect(b.ok && b.value?.length).toBe(4);
  });

  it("returns undefined for a missing file and removes files (idempotent)", async () => {
    const fsx = createWorkspaceFs(root);
    const miss = await fsx.readText("nope.md");
    expect(miss.ok && miss.value).toBeUndefined();
    await fsx.writeAtomic("f.md", "x");
    expect((await fsx.remove("f.md")).ok).toBe(true);
    expect((await fsx.remove("f.md")).ok).toBe(true);
  });

  it("rejects escaping paths with PATH_ESCAPE before touching the disk", async () => {
    const fsx = createWorkspaceFs(root);
    const r = await fsx.writeAtomic("../evil.md", "x");
    expect(!r.ok && r.error.code).toBe("PATH_ESCAPE");
  });
});
