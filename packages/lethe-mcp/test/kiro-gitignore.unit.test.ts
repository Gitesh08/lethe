import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Req 16.4, Req 16.5, REQ-HOK-4: `.kiro/` and its subfolders are never git-ignored.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function findGitignores(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findGitignores(full, out);
    else if (entry.name === ".gitignore") out.push(full);
  }
  return out;
}

/** Would this (de-negated, de-slashed) pattern match a `.kiro` path component? */
function patternTouchesKiro(raw: string): boolean {
  let p = raw.trim();
  if (p === "" || p.startsWith("#") || p.startsWith("!")) return false;
  p = p.replace(/^\/+/, "").replace(/\/+$/, "");
  p = p.replace(/^(\*\*\/)+/, "");
  if (p === ".kiro" || p.startsWith(".kiro/")) return true;
  if (p.includes("/")) return false;
  // Single-segment glob: convert to regex and test against ".kiro".
  const re = new RegExp(
    "^" +
      p
        .replace(/[.+^${}()|\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$",
  );
  return re.test(".kiro");
}

const probes = [
  ".kiro",
  ".kiro/",
  ".kiro/steering/06-memory.md",
  ".kiro/specs/lethe-mcp/tasks.md",
  ".kiro/hooks/lethe-check-on-save.json",
  ".kiro/settings/mcp.json",
  ".kiro/steering/lethe-sleep.md",
  ".kiro/lethe/state.json",
  ".kiro/lethe/ledger.jsonl",
  ".kiro/crypt/tombstones.json",
  ".kiro/lethe/backup/1/x.md",
  ".kiro/lethe/probe/x.json",
];

const gitVersion = spawnSync("git", ["--version"], { encoding: "utf8" });
const gitAvailable = gitVersion.status === 0;

describe("gitignore never ignores .kiro", () => {
  const files = findGitignores(root);

  it("finds the root .gitignore", () => {
    expect(files.map((f) => relative(root, f).replace(/\\/g, "/"))).toContain(".gitignore");
  });

  it("has no pattern that matches .kiro or a .kiro subfolder", () => {
    const offending: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (patternTouchesKiro(line)) {
          offending.push(`${relative(root, file)}:${i + 1}: ${line}`);
        }
      });
    }
    expect(offending, `ignore rules touching .kiro:\n${offending.join("\n")}`).toEqual([]);
  });

  it.skipIf(!gitAvailable)("git check-ignore reports every .kiro probe path as not ignored", () => {
    const res = spawnSync("git", ["-C", root, "check-ignore", "--no-index", "-v", "--", ...probes], {
      encoding: "utf8",
    });
    // Exit 1 = none of the paths are ignored; 0 = at least one is; 128 = fatal.
    expect(res.status, `git check-ignore matched:\n${res.stdout}${res.stderr}`).toBe(1);
    expect(res.stdout.trim()).toBe("");
  });
});
