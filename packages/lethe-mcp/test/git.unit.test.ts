import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGit } from "../src/io/git.js";

// Validates: Requirements 11.1, 11.2, 12.2

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const HAS_GIT = gitAvailable();
const temps: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lethe-git-"));
  temps.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    "git",
    ["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd, stdio: "ignore", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } },
  );
}

let repo = "";
let empty = "";
let plain = "";

beforeAll(() => {
  if (!HAS_GIT) {
    process.stderr.write("git tests skipped: git executable not found\n");
    return;
  }
  repo = tempDir();
  git(repo, "init", "-q");
  fs.writeFileSync(path.join(repo, "a.txt"), "a");
  git(repo, "add", "a.txt");
  git(repo, "commit", "-q", "-m", "one");
  fs.writeFileSync(path.join(repo, "b.txt"), "b");
  git(repo, "add", "b.txt");
  git(repo, "commit", "-q", "-m", "two");
  empty = tempDir();
  git(empty, "init", "-q");
  plain = tempDir();
});

afterAll(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

describe("createGit (real git)", () => {
  it("counts commits", async (ctx) => {
    if (!HAS_GIT) ctx.skip();
    expect(await createGit().commitCount(repo)).toBe(2);
  });

  it("returns undefined when HEAD has no commits", async (ctx) => {
    if (!HAS_GIT) ctx.skip();
    expect(await createGit().commitCount(empty)).toBeUndefined();
  });

  it("returns undefined outside a repository", async (ctx) => {
    if (!HAS_GIT) ctx.skip();
    // GIT_CEILING_DIRECTORIES prevents discovery of a repo above the temp dir.
    const env = () => ({ ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(plain) }) as Record<string, string>;
    expect(await createGit({ env }).commitCount(plain)).toBeUndefined();
  });

  it("lists changed and untracked files, sorted with / separators", async (ctx) => {
    if (!HAS_GIT) ctx.skip();
    fs.mkdirSync(path.join(repo, "sub"), { recursive: true });
    fs.writeFileSync(path.join(repo, "sub", "z.txt"), "z");
    fs.writeFileSync(path.join(repo, "a.txt"), "changed");
    expect(await createGit().changedFiles(repo)).toEqual(["a.txt", "sub/z.txt"]);
  });
});

describe("createGit (injected command)", () => {
  const node = process.execPath;

  it("falls back to undefined when the command exceeds the timeout", async () => {
    const slow = createGit({ command: node, prefixArgs: ["-e", "setTimeout(() => {}, 10000)", "--"], timeoutMs: 150 });
    const started = Date.now();
    expect(await slow.commitCount(os.tmpdir())).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it.each(["abc", "-3", "1.5", "", "12 34"])("rejects non-integer output %j", async (text) => {
    const g = createGit({ command: node, prefixArgs: ["-e", `process.stdout.write(${JSON.stringify(text)})`, "--"] });
    expect(await g.commitCount(os.tmpdir())).toBeUndefined();
  });

  it("accepts integer output with trailing newline", async () => {
    const g = createGit({ command: node, prefixArgs: ["-e", "console.log('7')", "--"] });
    expect(await g.commitCount(os.tmpdir())).toBe(7);
  });

  it("returns undefined when the command does not exist", async () => {
    expect(await createGit({ command: "lethe-no-such-git" }).commitCount(os.tmpdir())).toBeUndefined();
  });
});
