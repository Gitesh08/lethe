// Real-process exit codes and stream routing for the CLI. Refs: Req 13.7, 13.8, 13.9, 21.3
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LETHE_MCP_VERSION } from "../src/version.js";
import { buildTempBundle, spawnCli } from "./helpers/spawn-cli.js";
import { makeWorkspace } from "./support/cli-harness.js";

describe("spawned CLI process", () => {
  let tmp = "";
  let bundle = "";
  const workspaces: string[] = [];
  const ws = (files: Record<string, string>): string => {
    const d = makeWorkspace(files);
    workspaces.push(d);
    return d;
  };

  beforeAll(async () => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "lethe-cli-spawn-")));
    bundle = await buildTempBundle(tmp);
  }, 60_000);
  afterAll(() => {
    for (const d of [tmp, ...workspaces]) rmSync(d, { recursive: true, force: true });
  });

  it("score --json: exit 0, one JSON line on stdout, empty stderr", async () => {
    const d = ws({ ".kiro/steering/a.md": "## A\n\nKeep files small.\n" });
    const r = await spawnCli(bundle, ["score", "--json", "--commit", "5", "--now", "2026-11-10T12:00:00.000Z"], d);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout.endsWith("\n")).toBe(true);
    expect(r.stdout.trimEnd()).not.toContain("\n");
    expect((JSON.parse(r.stdout) as { ok: boolean }).ok).toBe(true);
  });

  it("check with findings: exit 1, summary on stderr, empty stdout", async () => {
    const d = ws({
      ".kiro/steering/a.md": "## A\n\nUse Redux.\n",
      ".kiro/steering/b.md": "## B\n\nUse signals.\n",
    });
    const r = await spawnCli(bundle, ["check", "--scope", "all", "--commit", "5", "--now", "2026-11-10T12:00:00.000Z"], d);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).not.toBe("");
  });

  it("unknown flag: exit 64, hint on stderr, empty stdout", async () => {
    const d = ws({});
    const r = await spawnCli(bundle, ["score", "--bogus"], d);
    expect(r.code).toBe(64);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("--bogus");
  });

  it("--version: exit 0, version on stdout, empty stderr", async () => {
    const r = await spawnCli(bundle, ["--version"], ws({}));
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`${LETHE_MCP_VERSION}\n`);
    expect(r.stderr).toBe("");
  });

  // A failing `sleep --apply` gate is NOT reachable from a spawned process: the CLI always uses the real
  // defaultGateRunner (which passes) and no config/env knob forces a failure. Adding one would be a
  // production backdoor, so that path stays covered in-process (cli-run-matrix, gate-failure tests).
  it.skip("sleep --apply with a failing gate: exit 1 (no seam in a spawned process)", () => undefined);
});
