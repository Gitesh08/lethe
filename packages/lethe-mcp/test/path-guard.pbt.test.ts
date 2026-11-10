// Property test for the path guard (Req 7.7, REQ-MCP-4): the result is a path whose real location is inside the
// workspace, or PATH_ESCAPE. The oracle is written independently of src/io/path-guard.ts.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { guardPath, resolveWorkspace, type FsProbe } from "../src/io/path-guard.js";
import { nodeFsProbe } from "../src/io/workspace-fs.js";
import { runProperty } from "./support/pbt-runner.js";

const NAMES = ["a", "b", "sub", "Sub", "SUB", "out", "OUT", "in", "In", "inner", "Inner", "x.md", "ws", "proj"];
const FRAGMENTS = ["C:", "C:x", "d:\\y", "\\\\server\\share", "\\\\?\\C:", "\\\\.\\pipe", "a.md:stream", "x.", "y ", "con", "NUL", "\0", "~", "%00"];
const segment = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom("..", "..", ".") },
  { weight: 6, arbitrary: fc.constantFrom(...NAMES) },
  { weight: 2, arbitrary: fc.constantFrom(...FRAGMENTS) },
);
const sep = fc.constantFrom("/", "\\");
const prefix = fc.constantFrom("", "", "", "/", "\\", "C:", "c:\\", "\\\\", "//");
const relArb = fc
  .tuple(prefix, fc.array(fc.tuple(segment, sep), { maxLength: 9 }), fc.boolean())
  .map(([pre, parts, trailing]) => {
    const body = parts.map(([s, p], i) => (i === parts.length - 1 && !trailing ? s : s + p)).join("");
    return pre + body;
  });

interface Plat {
  readonly name: "win32" | "linux";
  readonly sep: string;
  readonly root: string;
  readonly outside: string;
  readonly parents: readonly string[];
}
const PLATS: readonly Plat[] = [
  { name: "win32", sep: "\\", root: "D:\\Proj\\Lethe", outside: "D:\\Elsewhere", parents: ["D:\\", "D:\\Proj"] },
  { name: "linux", sep: "/", root: "/ws/proj", outside: "/elsewhere", parents: ["/", "/ws"] },
];

const fold = (pl: Plat, s: string): string => (pl.name === "win32" ? s.toLowerCase() : s);

/** Fake link table: `out` leaves the workspace, `in` stays inside. */
function linkTable(pl: Plat): ReadonlyArray<readonly [string, string]> {
  return [
    [pl.root + pl.sep + "out", pl.outside],
    [pl.root + pl.sep + "in", pl.root + pl.sep + "sub"],
  ];
}

/** Independent oracle resolver: substitutes a link prefix by its target. */
function through(pl: Plat, p: string): string {
  const f = fold(pl, p);
  for (const [from, to] of linkTable(pl)) {
    const key = fold(pl, from);
    if (f === key || f.startsWith(key + pl.sep)) return to + p.slice(from.length);
  }
  return p;
}

function fakeProbe(pl: Plat): FsProbe {
  const entries = new Set(
    [
      ...pl.parents,
      pl.root,
      pl.root + pl.sep + "sub",
      pl.root + pl.sep + "out",
      pl.root + pl.sep + "in",
      pl.outside,
      pl.outside + pl.sep + "inner",
    ].map((e) => fold(pl, e)),
  );
  const exists = (p: string): boolean => entries.has(fold(pl, p)) || entries.has(fold(pl, through(pl, p)));
  return { realpath: (p) => (exists(p) ? through(pl, p) : undefined), isDirectory: exists, exists };
}

function inside(sepr: string, ci: boolean, root: string, p: string): boolean {
  const r = ci ? root.toLowerCase() : root;
  const q = ci ? p.toLowerCase() : p;
  return q === r || q.startsWith(r + sepr);
}

describe("guardPath property (Req 7.7)", () => {
  for (const pl of PLATS) {
    it(`fake probe, ${pl.name}: ok implies real location inside the workspace`, () => {
      const probe = fakeProbe(pl);
      const ci = pl.name === "win32";
      runProperty(
        `path-guard/${pl.name}`,
        fc.property(relArb, (rel) => {
          const res = guardPath(pl.root, rel, probe, pl.name);
          if (!res.ok) return res.error.code === "PATH_ESCAPE";
          const v = res.value;
          if (rel.includes("\0")) return false;
          if (ci && rel.includes(":")) return false;
          return (
            inside(pl.sep, ci, pl.root, v) &&
            !v.split(pl.sep).includes("..") &&
            inside(pl.sep, ci, pl.root, through(pl, v))
          );
        }),
      );
    });
  }
});

describe("guardPath property against a real directory", () => {
  const base = mkdtempSync(join(tmpdir(), "lethe-pgp-"));
  const ws = join(base, "ws");
  const outside = join(base, "outside");
  mkdirSync(join(ws, "sub"), { recursive: true });
  mkdirSync(join(outside, "inner"), { recursive: true });
  writeFileSync(join(ws, "a"), "x");
  for (const [name, target] of [["out", outside], ["in", join(ws, "sub")]] as const) {
    try {
      symlinkSync(target, join(ws, name), process.platform === "win32" ? "junction" : "dir");
    } catch (e) {
      process.stderr.write(`[path-guard-pbt] link ${name} refused: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  /** Own real-location computation: realpath of the deepest existing ancestor plus the remainder. */
  function realOf(p: string): string {
    let cur = p;
    const tail: string[] = [];
    while (!existsSync(cur)) {
      tail.unshift(cur.slice(dirname(cur).length).replace(/^[\\/]/, ""));
      cur = dirname(cur);
    }
    return join(realpathSync.native(cur), ...tail);
  }

  it("ok implies the real location is inside the real workspace", () => {
    const r = resolveWorkspace(ws, nodeFsProbe);
    if (!r.ok) throw new Error(r.error.message);
    const root = r.value;
    const ci = process.platform === "win32";
    const s = ci ? "\\" : "/";
    runProperty(
      "path-guard/real-fs",
      fc.property(relArb, (rel) => {
        const res = guardPath(root, rel, nodeFsProbe);
        if (!res.ok) return res.error.code === "PATH_ESCAPE";
        return inside(s, ci, root, res.value) && inside(s, ci, realpathSync.native(root), realOf(res.value));
      }),
    );
    expect(existsSync(ws)).toBe(true);
  });
});
