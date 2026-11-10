import { describe, expect, it } from "vitest";
import { HOOK_OUTPUT_CAP, render } from "../src/cli/render.js";
import { fail, ok } from "../src/envelope/envelope.js";
import { toolError } from "../src/envelope/errors.js";

function report(i: number) {
  return {
    axis: "state-management", severity: "high",
    a: { id: `steering/a.md#rule-${i}-${"x".repeat(60)}`, stance: "redux", evidence: "e" },
    b: { id: `steering/b.md#rule-${i}-${"y".repeat(60)}`, stance: "signals", evidence: "e" },
    resolution: { kind: "resolved", winner: "a", loser: "b", reason: "spec" },
  };
}
const detect = (n: number) => ok(`${n} found`, { reports: Array.from({ length: n }, (_, i) => report(i)), count: n, unresolvable: 0, diagnostics: [] });

describe("render --json", () => {
  it("emits exactly one envelope line on stdout for success, failure, and usage", () => {
    const outcomes = [ok("fine", { a: 1 }), fail(toolError("IO_FAILED", "disk")), { kind: "usage" as const, message: "bad flag", hint: "try --help" }];
    for (const o of outcomes) {
      const r = render("score", o, { json: true });
      expect(r.stderr).toBe("");
      expect(r.stdout.endsWith("\n")).toBe(true);
      expect(r.stdout.trimEnd().split("\n")).toHaveLength(1);
      expect(typeof (JSON.parse(r.stdout) as { ok: unknown }).ok).toBe("boolean");
    }
  });

  it("usage error carries the hint in an INVALID_INPUT envelope", () => {
    const r = render("check", { kind: "usage", message: "bad", hint: "use --workspace" }, { json: true });
    const env = JSON.parse(r.stdout) as { ok: boolean; error: { code: string; detail: { hint: string } } };
    expect(env.ok).toBe(false);
    expect(env.error.code).toBe("INVALID_INPUT");
    expect(env.error.detail.hint).toBe("use --workspace");
  });
});

describe("render human", () => {
  it("success goes to stdout, failure to stderr", () => {
    const good = render("score", ok("all good", {}), {});
    expect(good.stdout).toContain("all good");
    expect(good.stderr).toBe("");
    const bad = render("score", fail(toolError("LOCKED", "busy")), {});
    expect(bad.stdout).toBe("");
    expect(bad.stderr).toContain("LOCKED: busy");
    const usage = render("score", { kind: "usage", message: "bad", hint: "hint here" }, {});
    expect(usage.stderr).toContain("hint here");
    expect(usage.stdout).toBe("");
  });

  it("check with findings writes to stderr; clean check to stdout", () => {
    expect(render("check", detect(1), {}).stderr).toContain("state-management");
    expect(render("check", detect(0), {}).stdout).toContain("0 found");
    expect(render("check", detect(1), { failOn: "never" }).stdout).toContain("state-management");
  });

  it("caps check output at 2000 chars and names the cut count", () => {
    const r = render("check", detect(40), {});
    expect(r.stderr.length).toBeLessThanOrEqual(HOOK_OUTPUT_CAP);
    const m = /\+(\d+) more reports? cut/.exec(r.stderr);
    expect(m).not.toBeNull();
    const shown = r.stderr.split("\n").filter((l) => l.startsWith("- [")).length;
    expect(shown + Number(m?.[1])).toBe(40);
  });

  it("does not cut small outputs", () => {
    expect(render("check", detect(2), {}).stderr).not.toContain("cut");
  });

  it("labels reinforcement as estimated utility", () => {
    expect(render("record", ok("Recorded task_passed.", {}), {}).stdout).toContain("estimated utility");
    expect(render("score", ok("3 reinforcements", {}), {}).stdout).toContain("estimated utility");
    expect(render("score", ok("3 reinforcements (estimated utility)", {}), {}).stdout.match(/estimated utility/g)).toHaveLength(1);
  });

  it("names the failing property on a sleep gate failure", () => {
    const r = render("sleep", ok("gate failed", { pbtGate: "failed", gateFailure: { propertyId: "P8", seed: 7 } }), {});
    expect(r.stderr).toContain("P8");
  });
});
