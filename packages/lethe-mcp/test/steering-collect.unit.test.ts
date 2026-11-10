// Full collection matrix for load/steering.ts. Refs: Req 10.1, 10.2, REQ-PAR-5
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_CONFIG, serializeDocument } from "@lethe/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";
import { collectSteering, MAX_MARKDOWN_BYTES } from "../src/load/steering.js";

const S = ".kiro/steering";
let root = "";
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-coll-")));
  mkdirSync(join(root, ".kiro", "steering"), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const put = (rel: string, data: string | Uint8Array): void => {
  const abs = join(root, ...rel.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, data);
};
const run = async (includeSpecs = false) => {
  const r = await collectSteering(createWorkspaceFs(root), DEFAULT_CONFIG, { includeSpecs });
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};

describe("collectSteering text fidelity", () => {
  it("keeps a BOM-only file byte-exact", async () => {
    put(`${S}/bom.md`, "\uFEFF");
    const c = await run();
    expect(c.steeringFiles.get(`${S}/bom.md`)).toBe("\uFEFF");
    expect(c.diagnostics).toEqual([]);
  });

  it("preserves mixed CRLF/LF and round-trips through core serialize", async () => {
    const text = "\uFEFF## One\r\n\r\nline\nmixed\r\n\n## Two\n\r\ntail\r\n";
    put(`${S}/mix.md`, text);
    const c = await run();
    expect(c.steeringFiles.get(`${S}/mix.md`)).toBe(text);
    const doc = c.docs.get(`${S}/mix.md`);
    expect(doc).toBeDefined();
    if (doc !== undefined) expect(serializeDocument(doc)).toBe(text);
  });
});

describe("collectSteering ordering and discovery", () => {
  it("orders by UTF-16 code unit, not locale", async () => {
    for (const n of ["a.md", "a-b.md", "a.b.md", "a/x.md", "B.md", "2.md", "10.md"]) put(`${S}/${n}`, "## H\n\nx\n");
    const c = await run();
    expect([...c.steeringFiles.keys()].map((k) => k.slice(S.length + 1))).toEqual([
      "10.md", "2.md", "B.md", "a-b.md", "a.b.md", "a.md", "a/x.md",
    ]);
  });

  it("ignores non-.md names (case-sensitive suffix; .MD is NOT collected)", async () => {
    for (const n of ["u.MD", "v.markdown", "w.md.bak", "noext", "x.mdx"]) put(`${S}/${n}`, "## H\n\nx\n");
    put(`${S}/ok.md`, "## H\n\nx\n");
    expect([...(await run()).steeringFiles.keys()]).toEqual([`${S}/ok.md`]);
  });

  it("walks nested folders to depth 8 and ignores anything deeper", async () => {
    const dirs = Array.from({ length: 9 }, (_, i) => `d${i + 1}`);
    for (let n = 1; n <= 9; n++) put(`${S}/${dirs.slice(0, n).join("/")}/f.md`, "## H\n\nx\n");
    const keys = [...(await run()).steeringFiles.keys()];
    expect(keys).toHaveLength(8);
    expect(keys).toContain(`${S}/${dirs.slice(0, 8).join("/")}/f.md`);
    expect(keys).not.toContain(`${S}/${dirs.join("/")}/f.md`);
  });
});

describe("collectSteering size and encoding", () => {
  it("counts bytes, not characters, at the 1 MiB boundary", async () => {
    const euro = "\u20AC"; // 3 bytes in UTF-8
    const fit = euro.repeat(349_525) + "a"; // exactly 1_048_576 bytes
    expect(Buffer.byteLength(fit)).toBe(MAX_MARKDOWN_BYTES);
    put(`${S}/fit.md`, fit);
    put(`${S}/over.md`, euro.repeat(349_526)); // 1_048_578 bytes, fewer chars than the limit
    const c = await run();
    expect(c.steeringFiles.get(`${S}/fit.md`)).toBe(fit);
    expect(c.steeringFiles.has(`${S}/over.md`)).toBe(false);
    expect(c.diagnostics.map((d) => [d.code, d.file])).toEqual([["FILE_TOO_LARGE", `${S}/over.md`]]);
  });

  it("invalid UTF-8 in a spec file: neverRewrite yes, anySteeringSkipped no", async () => {
    put(`${S}/ok.md`, "## H\n\nx\n");
    put(".kiro/specs/s/requirements.md", new Uint8Array([0x23, 0x20, 0xc3, 0x28, 0x0a]));
    const c = await run(true);
    expect(c.neverRewrite).toEqual([".kiro/specs/s/requirements.md"]);
    expect(c.anySteeringSkipped).toBe(false);
    expect(c.diagnostics.map((d) => d.code)).toEqual(["FILE_NOT_UTF8"]);
  });

  it("reports PARSE_SKIPPED when core rejects the file (unclosed frontmatter)", async () => {
    put(`${S}/bad.md`, "---\nglobs: x\n## H\n\nbody\n");
    const c = await run();
    expect(c.steeringFiles.size).toBe(0);
    expect(c.diagnostics).toEqual([expect.objectContaining({ code: "PARSE_SKIPPED", file: `${S}/bad.md` })]);
    expect(c.diagnostics[0]?.message).toContain("PARSE_INVALID_FRONTMATTER");
    expect(c.neverRewrite).toEqual([`${S}/bad.md`]);
    expect(c.anySteeringSkipped).toBe(true);
  });
});

describe("collectSteering determinism", () => {
  it("emits diagnostics steering-first in path order, and repeats deep-equal", async () => {
    put(`${S}/z.md`, new Uint8Array([0xff]));
    put(`${S}/b.md`, new Uint8Array([0xff]));
    put(`${S}/ok.md`, "## H\n\nx\n");
    put(".kiro/specs/a/requirements.md", new Uint8Array([0xff]));
    const c1 = await run(true);
    expect(c1.diagnostics.map((d) => d.file)).toEqual([`${S}/b.md`, `${S}/z.md`, ".kiro/specs/a/requirements.md"]);
    expect(c1.neverRewrite).toEqual([".kiro/specs/a/requirements.md", `${S}/b.md`, `${S}/z.md`]);
    expect(await run(true)).toEqual(c1);
  });
});
