// Unit tests for ops/probe.ts. Refs: Req 19.3, 19.4, 20.1
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildContext, type RunContext } from "../src/ops/context.js";
import { PROBE_MAX_STDIN_BYTES, compactStamp, probeOp } from "../src/ops/probe.js";

const NOW = "2026-11-10T12:00:00.123Z";
const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lethe-probe-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function ctx(): Promise<RunContext> {
  const r = await buildContext({ workspacePath: dir, commit: 1, now: NOW }, { git: noGit, log: () => undefined });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

const probeDir = (): string => join(dir, ".kiro", "lethe", "probe");

describe("probeOp", () => {
  it("captures parsed JSON stdin under an event-named file", async () => {
    const c = await ctx();
    const r = await probeOp(c, { stdin: '{"hook_event_name":"PostFileSave","file":"a.md"}', argv: ["probe"], cwd: "/w" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.file).toBe(".kiro/lethe/probe/20261110T120000123Z-PostFileSave.json");
    const cap = JSON.parse(readFileSync(join(dir, r.value.file), "utf8")) as Record<string, unknown>;
    expect(Object.keys(cap)).toEqual(["receivedAt", "argv", "cwd", "stdinRaw", "stdinParsed"]);
    expect(cap["stdinParsed"]).toEqual({ hook_event_name: "PostFileSave", file: "a.md" });
    expect(cap["receivedAt"]).toBe(NOW);
  });

  it("handles non-JSON stdin without stdinParsed", async () => {
    const r = await probeOp(await ctx(), { stdin: "not json {", argv: [], cwd: "/w" });
    expect(r.ok && r.value.event).toBe("unknown");
    if (!r.ok) return;
    const cap = JSON.parse(readFileSync(join(dir, r.value.file), "utf8")) as Record<string, unknown>;
    expect(cap["stdinRaw"]).toBe("not json {");
    expect("stdinParsed" in cap).toBe(false);
  });

  it("never writes secret values or env", async () => {
    process.env["LETHE_PROBE_TEST_SECRET"] = "env-secret-zzz";
    const stdin = JSON.stringify({ hook_event_name: "X", api_key: "sk-AAA111", nested: { password: "hunter2" }, note: "token=abc999" });
    const r1 = await probeOp(await ctx(), { stdin, argv: ["--token=argvsecret1"], cwd: "/w" });
    const r2 = await probeOp(await ctx(), { stdin: "Authorization: Bearer-xyz777 password=plain555", argv: [], cwd: "/w" });
    expect(r1.ok && r2.ok).toBe(true);
    const bytes = readdirSync(probeDir()).map((f) => readFileSync(join(probeDir(), f), "utf8")).join("\n");
    for (const s of ["sk-AAA111", "hunter2", "abc999", "argvsecret1", "xyz777", "plain555", "env-secret-zzz"]) {
      expect(bytes).not.toContain(s);
    }
    expect(bytes).toContain("[REDACTED]");
    delete process.env["LETHE_PROBE_TEST_SECRET"];
  });

  it("writes only the probe directory and does not overwrite on name collision", async () => {
    const c = await ctx();
    await probeOp(c, { stdin: "{}", argv: [], cwd: "/w" });
    await probeOp(c, { stdin: "{}", argv: [], cwd: "/w" });
    expect(readdirSync(probeDir()).sort()).toEqual(["20261110T120000123Z-unknown-2.json", "20261110T120000123Z-unknown.json"]);
    expect(readdirSync(join(dir, ".kiro"))).toEqual(["lethe"]);
    expect(readdirSync(join(dir, ".kiro", "lethe"))).toEqual(["probe"]);
  });

  it("caps stdin at 1 MiB and skips parsing", async () => {
    const stdin = JSON.stringify({ blob: "a".repeat(PROBE_MAX_STDIN_BYTES + 10) });
    const r = await probeOp(await ctx(), { stdin, argv: [], cwd: "/w" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.truncated).toBe(true);
    expect(r.value.parsed).toBe(false);
    const cap = JSON.parse(readFileSync(join(dir, r.value.file), "utf8")) as { stdinRaw: string };
    expect(Buffer.byteLength(cap.stdinRaw)).toBeLessThanOrEqual(PROBE_MAX_STDIN_BYTES);
  });

  it("sanitises the event name and formats the stamp", async () => {
    const r = await probeOp(await ctx(), { stdin: '{"hook_event_name":"../Evil name"}', argv: [], cwd: "/w" });
    expect(r.ok && r.value.event).toBe("___Evil_name");
    expect(compactStamp(NOW)).toBe("20261110T120000123Z");
    expect(existsSync(probeDir())).toBe(true);
  });
});
