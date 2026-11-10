// Bundle runs standalone, with no node_modules nearby. Refs: Req 18.2, 18.6, NFR-4
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { LETHE_MCP_VERSION } from "../src/version.js";

const src = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "lethe.mjs");
let tmp = "";

afterAll(() => {
  if (tmp !== "") rmSync(tmp, { recursive: true, force: true });
});

describe("standalone bundle", () => {
  it("runs --version from an empty temp dir", () => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "lethe-standalone-")));
    const dest = join(tmp, "lethe.mjs");
    copyFileSync(src, dest);
    const r = spawnSync(process.execPath, [dest, "--version"], { cwd: tmp, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`${LETHE_MCP_VERSION}\n`);
  }, 30_000);
});
