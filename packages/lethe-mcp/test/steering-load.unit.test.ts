// Basic coverage for load/steering.ts (full matrix is task 5.2). Refs: Req 10.1, 10.2, REQ-PAR-5
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "@lethe/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";
import { collectSteering, MAX_MARKDOWN_BYTES } from "../src/load/steering.js";

let root = "";
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-steer-")));
  mkdirSync(join(root, ".kiro", "steering", "sub"), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const put = (rel: string, data: string | Uint8Array): void => writeFileSync(join(root, ...rel.split("/")), data);
const run = async (includeSpecs = false) => {
  const r = await collectSteering(createWorkspaceFs(root), DEFAULT_CONFIG, { includeSpecs });
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};

describe("collectSteering", () => {
  it("collects sorted markdown keyed by / paths, exact text (BOM, CRLF)", async () => {
    put(".kiro/steering/b.md", "\uFEFF## B\r\n\r\nbody\r\n");
    put(".kiro/steering/a.md", "## A\n\nbody\n");
    put(".kiro/steering/sub/c.md", "## C\n\nx\n");
    put(".kiro/steering/notes.txt", "ignored");
    const c = await run();
    expect([...c.steeringFiles.keys()]).toEqual([".kiro/steering/a.md", ".kiro/steering/b.md", ".kiro/steering/sub/c.md"]);
    expect(c.steeringFiles.get(".kiro/steering/b.md")).toBe("\uFEFF## B\r\n\r\nbody\r\n");
    expect(c.engrams.length).toBeGreaterThan(0);
    expect(c.neverRewrite).toEqual([]);
    expect(c.anySteeringSkipped).toBe(false);
  });

  it("includes specs only when requested", async () => {
    mkdirSync(join(root, ".kiro", "specs", "s1"), { recursive: true });
    put(".kiro/specs/s1/requirements.md", "## R\n\nThe system SHALL work.\n");
    expect((await run()).specFiles.size).toBe(0);
    const c = await run(true);
    expect([...c.specFiles.keys()]).toEqual([".kiro/specs/s1/requirements.md"]);
    expect(c.specEngrams.length).toBeGreaterThan(0);
  });

  it("loads exactly 1 MiB but skips 1 MiB + 1 with FILE_TOO_LARGE", async () => {
    put(".kiro/steering/ok.md", Buffer.alloc(MAX_MARKDOWN_BYTES, 0x61));
    put(".kiro/steering/big.md", Buffer.alloc(MAX_MARKDOWN_BYTES + 1, 0x61));
    const c = await run();
    expect(c.steeringFiles.has(".kiro/steering/ok.md")).toBe(true);
    expect(c.steeringFiles.has(".kiro/steering/big.md")).toBe(false);
    expect(c.neverRewrite).toEqual([".kiro/steering/big.md"]);
    expect(c.diagnostics).toEqual([expect.objectContaining({ code: "FILE_TOO_LARGE", file: ".kiro/steering/big.md" })]);
    expect(c.anySteeringSkipped).toBe(true);
  });

  it("skips invalid UTF-8 with FILE_NOT_UTF8", async () => {
    put(".kiro/steering/bad.md", new Uint8Array([0x23, 0x20, 0xff, 0xfe, 0x0a]));
    const c = await run();
    expect(c.steeringFiles.size).toBe(0);
    expect(c.diagnostics.map((d) => d.code)).toEqual(["FILE_NOT_UTF8"]);
    expect(c.neverRewrite).toEqual([".kiro/steering/bad.md"]);
  });

  it("returns empty results when the steering directory is absent", async () => {
    rmSync(join(root, ".kiro"), { recursive: true, force: true });
    const c = await run();
    expect(c.steeringFiles.size).toBe(0);
    expect(c.diagnostics).toEqual([]);
  });

  it("does not follow symlinked directories out of the workspace", async (ctx) => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "lethe-out-")));
    try {
      writeFileSync(join(outside, "x.md"), "## X\n\nleak\n");
      try {
        symlinkSync(outside, join(root, ".kiro", "steering", "link"), "junction");
      } catch {
        ctx.skip();
      }
      const c = await run();
      expect([...c.steeringFiles.keys()].filter((k) => k.includes("link"))).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
