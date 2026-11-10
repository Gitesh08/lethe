// Sample-payload tests for ops/probe.ts. Refs: Req 19.3, 19.4, 20.1
// Contract note: Req 19.4 says the environment is NEVER captured (stricter than "names on an allow-list"), so we assert
// that neither env values nor env names reach disk and that no `env` key exists.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildContext, type RunContext } from "../src/ops/context.js";
import { probeOp } from "../src/ops/probe.js";

const NOW = "2026-11-10T12:00:00.123Z";
const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
const KEYS = ["receivedAt", "argv", "cwd", "stdinRaw", "stdinParsed"];
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lethe-probe-sample-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function ctx(): Promise<RunContext> {
  const r = await buildContext({ workspacePath: dir, commit: 1, now: NOW }, { git: noGit, log: () => undefined });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

/** Sorted `relative path -> size` map of every file in the workspace. */
function snapshot(root: string, rel = ""): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of readdirSync(join(root, rel)).sort()) {
    const r = rel === "" ? name : `${rel}/${name}`;
    if (statSync(join(root, r)).isDirectory()) Object.assign(out, snapshot(root, r));
    else out[r] = statSync(join(root, r)).size;
  }
  return out;
}

const read = (rel: string): string => readFileSync(join(dir, rel), "utf8");

const postFileSave = {
  hook_event_name: "PostFileSave",
  cwd: "/work/lethe",
  file: { path: ".kiro/steering/06-memory.md", bytes: 5120, created: false, binary: null },
  tags: ["steering", "markdown"],
  api_key: "sk-sample-111",
};
const postTaskExec = {
  hook_event_name: "PostTaskExec",
  task: { id: "7.16", title: "Test for probeOp", done: true, subtasks: [{ id: "7.16.1", done: false }], exit: 0 },
  specs: [],
  ratio: 0.75,
  auth_token: "tok-sample-222",
};

describe("probeOp with sample hook payloads", () => {
  it.each([
    ["PostFileSave", postFileSave, { api_key: "[REDACTED]" }],
    ["PostTaskExec", postTaskExec, { auth_token: "[REDACTED]" }],
  ])("captures a %s payload with the exact key order and redacted secrets", async (event, payload, redacted) => {
    const stdin = JSON.stringify(payload);
    const r = await probeOp(await ctx(), { stdin, argv: ["probe", "--workspace", "."], cwd: "/work/lethe" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ event, parsed: true, truncated: false, stdinBytes: Buffer.byteLength(stdin) });
    expect(r.value.file).toBe(`.kiro/lethe/probe/20261110T120000123Z-${event}.json`);
    const cap = JSON.parse(read(r.value.file)) as Record<string, unknown>;
    expect(Object.keys(cap)).toEqual(KEYS);
    expect(cap["receivedAt"]).toBe(NOW);
    expect(cap["argv"]).toEqual(["probe", "--workspace", "."]);
    expect(cap["cwd"]).toBe("/work/lethe");
    const expected = { ...payload, ...redacted };
    expect(cap["stdinParsed"]).toEqual(expected);
    expect(JSON.parse(cap["stdinRaw"] as string)).toEqual(expected);
  });

  it("never captures env values or names, and has no env key", async () => {
    const prev = process.env["LETHE_PROBE_SECRET_TEST"];
    process.env["LETHE_PROBE_SECRET_TEST"] = "s3cr3t-value";
    try {
      const c = await ctx();
      await probeOp(c, { stdin: JSON.stringify(postFileSave), argv: ["probe"], cwd: "/w" });
      await probeOp(c, { stdin: JSON.stringify(postTaskExec), argv: ["probe"], cwd: "/w" });
      await probeOp(c, { stdin: "plain text", argv: ["probe"], cwd: "/w" });
      const files = readdirSync(join(dir, ".kiro", "lethe", "probe"));
      expect(files).toHaveLength(3);
      for (const f of files) {
        const text = read(`.kiro/lethe/probe/${f}`);
        expect(text).not.toContain("s3cr3t-value");
        expect(text).not.toContain("LETHE_PROBE_SECRET_TEST");
        expect(Object.keys(JSON.parse(text) as object)).not.toContain("env");
        expect(text).not.toMatch(/"env"/);
      }
    } finally {
      if (prev === undefined) delete process.env["LETHE_PROBE_SECRET_TEST"];
      else process.env["LETHE_PROBE_SECRET_TEST"] = prev;
    }
  });

  it("creates only files under .kiro/lethe/probe/", async () => {
    const c = await ctx();
    const before = snapshot(dir);
    await probeOp(c, { stdin: JSON.stringify(postFileSave), argv: [], cwd: "/w" });
    await probeOp(c, { stdin: JSON.stringify(postTaskExec), argv: [], cwd: "/w" });
    const after = snapshot(dir);
    const added = Object.keys(after).filter((k) => !(k in before));
    expect(added).toHaveLength(2);
    for (const k of added) expect(k.startsWith(".kiro/lethe/probe/")).toBe(true);
    for (const k of Object.keys(before)) expect(after[k]).toBe(before[k]);
  });
});
