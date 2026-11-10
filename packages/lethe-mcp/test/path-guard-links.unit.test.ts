// Real symlink / junction escape tests (Req 7.3, REQ-MCP-4). Skipped with a stderr reason when the OS refuses links.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, type TaskContext } from "vitest";
import { guardPath, resolveWorkspace } from "../src/io/path-guard.js";
import { nodeFsProbe } from "../src/io/workspace-fs.js";

type LinkKind = "dir" | "file" | "junction";

let base = "";
let ws = "";
let outside = "";
const skipped = new Map<LinkKind, string>();

/** Tries to create a link; records the refusal reason and returns false when not permitted. */
function tryLink(kind: LinkKind, target: string, at: string): boolean {
  try {
    symlinkSync(target, at, kind);
    return true;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    skipped.set(kind, reason);
    process.stderr.write(`[path-guard-links] ${kind} link creation refused, skipping: ${reason}\n`);
    return false;
  }
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "lethe-pg-"));
  ws = join(base, "ws");
  outside = join(base, "outside");
  mkdirSync(ws);
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "secret");
  writeFileSync(join(ws, "inside.txt"), "ok");
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

function root(): string {
  const r = resolveWorkspace(ws, nodeFsProbe);
  if (!r.ok) throw new Error(`workspace did not resolve: ${r.error.message}`);
  return r.value;
}

function check(ctx: Pick<TaskContext, "skip">, kind: LinkKind, make: () => boolean, rels: readonly string[], expected: "ok" | "PATH_ESCAPE"): void {
  if (!make()) ctx.skip(); // reason also on stderr
  const r = root();
  for (const rel of rels) {
    const res = guardPath(r, rel, nodeFsProbe);
    expect(res.ok ? "ok" : res.error.code, `${kind}: ${rel}`).toBe(expected);
  }
}

describe("guardPath with real links", () => {
  it("plain files and not-yet-existing paths are accepted", () => {
    const r = root();
    expect(guardPath(r, "inside.txt", nodeFsProbe).ok).toBe(true);
    expect(guardPath(r, "new/dir/file.md", nodeFsProbe).ok).toBe(true);
  });

  const dirKinds: LinkKind[] = process.platform === "win32" ? ["junction", "dir"] : ["dir"];
  for (const kind of dirKinds) {
    it(`rejects a ${kind} link to a directory outside the workspace`, (ctx) => {
      const name = `link-${kind}`;
      check(ctx, kind, () => tryLink(kind, outside, join(ws, name)), [name, `${name}/secret.txt`, `${name}/new.txt`, `${name}/a/b`], "PATH_ESCAPE");
    });
  }

  it("rejects a file symlink to a file outside the workspace", (ctx) => {
    const target = join(outside, "secret.txt");
    check(ctx, "file", () => tryLink("file", target, join(ws, "link-file")), ["link-file"], "PATH_ESCAPE");
  });

  it("rejects a dangling link whose target is outside the workspace", (ctx) => {
    const target = join(outside, "does-not-exist.txt");
    check(ctx, "file", () => tryLink("file", target, join(ws, "dangling")), ["dangling"], "PATH_ESCAPE");
  });

  it("accepts a link that stays inside the workspace", (ctx) => {
    mkdirSync(join(ws, "real"), { recursive: true });
    const kind: LinkKind = process.platform === "win32" ? "junction" : "dir";
    check(ctx, kind, () => tryLink(kind, join(ws, "real"), join(ws, "alias")), ["alias/x.md"], "ok");
  });

  it("resolves a workspace given through a link to its real path", (ctx) => {
    const kind: LinkKind = process.platform === "win32" ? "junction" : "dir";
    const alias = join(base, "ws-alias");
    if (!tryLink(kind, ws, alias)) ctx.skip();
    const r = resolveWorkspace(alias, nodeFsProbe);
    expect(r.ok && r.value.toLowerCase()).toBe(root().toLowerCase());
  });

  it("records which link kinds were skipped", () => {
    // Informational: the reasons were also written to stderr by tryLink.
    expect([...skipped.keys()].every((k) => typeof skipped.get(k) === "string")).toBe(true);
  });
});
