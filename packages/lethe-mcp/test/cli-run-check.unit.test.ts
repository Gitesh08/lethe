// `check` exit codes, stream routing, determinism and stdin use through runCli. Refs: Req 13.3, 13.4, 13.5, 13.7, 13.8, 21.3
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { FIXED, NOW, isOneJsonLine, makeWorkspace, runIn } from "./support/cli-harness.js";

const dirs: string[] = [];
const ws = (files: Record<string, string>): string => {
  const d = makeWorkspace(files);
  dirs.push(d);
  return d;
};
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const haunted = (): string => ws({
  ".kiro/steering/a.md": "## A\n\nUse Redux.\n",
  ".kiro/steering/b.md": "## B\n\nUse signals.\n",
});
const clean = (): string => ws({ ".kiro/steering/a.md": "## A\n\nKeep files small.\n" });

describe("check exit codes (--scope all)", () => {
  // Both engrams are unprotected, so the pair is resolved, not unresolvable.
  const rows: ReadonlyArray<readonly [string, boolean, number]> = [
    ["any", false, 1], ["any", true, 2],
    ["unresolvable", false, 0], ["unresolvable", true, 0],
    ["never", false, 0], ["never", true, 0],
  ];
  for (const [failOn, block, code] of rows) {
    it(`--fail-on ${failOn}${block ? " --block" : ""} on contradictions -> ${code}`, async () => {
      const argv = ["check", "--scope", "all", "--fail-on", failOn, ...(block ? ["--block"] : []), ...FIXED];
      expect((await runIn(haunted(), argv)).exitCode).toBe(code);
    });
  }

  it("a clean workspace exits 0 for every --fail-on / --block combination", async () => {
    const d = clean();
    for (const failOn of ["any", "unresolvable", "never"]) {
      for (const block of [[], ["--block"]]) {
        const r = await runIn(d, ["check", "--scope", "all", "--fail-on", failOn, ...block, ...FIXED]);
        expect(r.exitCode, `${failOn} ${block.join("")}`).toBe(0);
      }
    }
  });

  it("an unresolvable pair (both pinned) exits 1 under --fail-on unresolvable, 2 with --block", async () => {
    const d = ws({
      ".kiro/steering/a.md": "## A\n\n<!-- lethe: pin=true -->\nUse Redux.\n",
      ".kiro/steering/b.md": "## B\n\n<!-- lethe: pin=true -->\nUse signals.\n",
    });
    const base = ["check", "--scope", "all", "--fail-on", "unresolvable"];
    expect((await runIn(d, [...base, ...FIXED])).exitCode).toBe(1);
    expect((await runIn(d, [...base, "--block", ...FIXED])).exitCode).toBe(2);
  });
});

describe("stream routing", () => {
  it("human mode: findings (exit 1) land on stderr only", async () => {
    const r = await runIn(haunted(), ["check", "--scope", "all", ...FIXED]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).not.toBe("");
  });

  it("human mode: success (exit 0) lands on stdout only", async () => {
    for (const argv of [["check", "--scope", "all"], ["score"], ["adopt"], ["sleep"]]) {
      const r = await runIn(clean(), [...argv, ...FIXED]);
      expect(r.exitCode, argv[0]).toBe(0);
      expect(r.stdout, argv[0]).not.toBe("");
      expect(r.stderr, argv[0]).toBe("");
    }
  });

  it("--json: exactly one parseable line on stdout and nothing on stderr, at any exit", async () => {
    for (const [d, argv] of [
      [haunted(), ["check", "--scope", "all"]], [clean(), ["check", "--scope", "all"]],
      [clean(), ["score"]], [clean(), ["resurrect", "--query", "nope"]],
    ] as const) {
      const r = await runIn(d, [...argv, "--json", ...FIXED]);
      expect(isOneJsonLine(r.stdout), `${argv.join(" ")} (${r.exitCode})`).toBe(true);
      expect(r.stderr).toBe("");
    }
  });

  it("--json exit 1 still prints the full envelope on stdout", async () => {
    const r = await runIn(haunted(), ["check", "--scope", "all", "--json", ...FIXED]);
    expect(r.exitCode).toBe(1);
    expect((JSON.parse(r.stdout) as { ok: boolean }).ok).toBe(true);
  });
});

describe("determinism and wording", () => {
  it("two score --json runs with --commit and --now are byte-identical", async () => {
    const d = haunted();
    const argv = ["score", "--json", "--commit", "5", "--now", NOW];
    const a = await runIn(d, argv);
    const b = await runIn(d, argv);
    expect(a.exitCode).toBe(0);
    expect(a.stdout).toBe(b.stdout);
    expect(a.stdout).toContain(NOW);
  });

  it("check --json is byte-identical across runs in separate identical workspaces", async () => {
    const argv = ["check", "--scope", "all", "--json", ...FIXED];
    expect((await runIn(haunted(), argv)).stdout).toBe((await runIn(haunted(), argv)).stdout);
  });

  it("record output says 'estimated utility' in human and JSON modes", async () => {
    const d = clean();
    const h = await runIn(d, ["record", "--type", "task_passed", "--files", "a.ts", ...FIXED]);
    expect(h.exitCode).toBe(0);
    expect(h.stdout).toContain("estimated utility");
    const j = await runIn(d, ["record", "--type", "task_passed", "--files", "a.ts", "--json", ...FIXED]);
    expect(j.stdout).toContain("estimated utility");
  });
});

describe("stdin", () => {
  it("only probe reads stdin", async () => {
    const d = clean();
    for (const argv of [["check"], ["score"], ["sleep"], ["adopt"], ["resurrect", "--query", "x"], ["record", "--type", "task_passed"]]) {
      expect((await runIn(d, [...argv, ...FIXED])).stdinReads, argv[0]).toBe(0);
    }
    const p = await runIn(d, ["probe", ...FIXED], {}, '{"hook_event_name":"PostTaskExec"}');
    expect(p.exitCode).toBe(0);
    expect(p.stdinReads).toBe(1);
  });
});
