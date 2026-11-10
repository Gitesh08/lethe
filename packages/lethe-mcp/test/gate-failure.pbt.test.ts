// Gate failure paths of sleepOp (task 8.3). Refs: Req 14.2, 14.3, 14.4, 14.5, 14.7, 21.7
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPbtFailureCore, type GateOutcome, type GateRunner } from "../src/gate/gate.js";
import { buildContext, type RunContext } from "../src/ops/context.js";
import { sleepOp, type SleepOpInput } from "../src/ops/sleep.js";
import { PBT_FAILURES_REL, type GateFailure } from "../src/persist/pbt-failures.js";
import { runAsyncProperty } from "./support/pbt-runner.js";

const NOW = "2026-11-10T12:00:00.000Z";
const STEERING = ".kiro/steering/a.md";
const STATE = ".kiro/lethe/state.json";
const TEXT = [
  "## Pinned rule",
  "<!-- lethe: pin=true -->",
  "",
  "Always keep this pinned rule around for the whole project lifetime.",
  "",
  "## Loose rule one",
  "",
  "Prefer small functions and short files in every module of the codebase.",
  "",
  "## Loose rule two",
  "",
  "Name tests after the behaviour they check, in plain words, always.",
  "",
].join("\n");
const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };

let dir = "";
let original = new Map<string, string>();

const listFiles = (): Map<string, string> => {
  const m = new Map<string, string>();
  for (const p of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const abs = join(dir, p);
    if (statSync(abs).isFile()) m.set(p.replaceAll("\\", "/"), readFileSync(abs, "utf8"));
  }
  return m;
};

async function ctxWith(gate: GateRunner): Promise<RunContext> {
  const r = await buildContext(
    { workspacePath: dir, commit: 10, now: NOW },
    { git: noGit, lock: { waitMs: 0 }, log: () => undefined, gate },
  );
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
const input = (over: Partial<SleepOpInput> = {}): SleepOpInput => ({ apply: true, skipGate: false, gateRuns: 20, ...over });

/** Wipes the workspace back to the original files. */
function restore(): void {
  for (const p of readdirSync(dir)) rmSync(join(dir, p), { recursive: true, force: true });
  for (const [rel, text] of original) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
}

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-gate-fail-")));
  mkdirSync(join(dir, ".kiro", "steering"), { recursive: true });
  writeFileSync(join(dir, STEERING), TEXT);
  const probe = await sleepOp(await ctxWith(async () => ({ status: "passed", ran: 12, numRuns: 20 })), input({ apply: false }));
  if (!probe.ok) throw new Error(probe.error.message);
  const engrams: Record<string, unknown> = {};
  for (const id of probe.value.checkpoint.stamped) {
    if (!id.includes("pinned")) engrams[id] = { stability: 0.5, lastReinforcedCommit: 0, lastReinforcedAt: NOW, reinforcements: 0 };
  }
  const ledger = { lines: 0, bytes: 0, lastLineSha256: null };
  mkdirSync(join(dir, ".kiro", "lethe"), { recursive: true });
  writeFileSync(join(dir, STATE), JSON.stringify({ version: 1, commit: 10, at: NOW, ledger, engrams }));
  original = listFiles();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const failureArb: fc.Arbitrary<GateFailure> = fc.record({
  status: fc.constant("failed" as const),
  propertyId: fc.integer({ min: 1, max: 12 }).map((n) => `P${n}`),
  seed: fc.integer(),
  counterexample: fc.jsonValue(),
  message: fc.string(),
});

function recordingGate(failure: GateFailure): { gate: GateRunner; seen: number[] } {
  const seen: number[] = [];
  const gate: GateRunner = async (_cfg, numRuns): Promise<GateOutcome> => {
    seen.push(numRuns);
    return { status: "failed", failure };
  };
  return { gate, seen };
}

describe("sleepOp gate failure (property)", () => {
  it("apply and dry-run failures leave targets untouched and only record pbt-failures.json", async () => {
    const core = await loadPbtFailureCore();
    await runAsyncProperty(
      "gate-failure",
      fc.asyncProperty(failureArb, fc.integer({ min: 1, max: 10000 }), async (failure, gateRuns) => {
        restore();
        const expected = core.appendPbtFailure(undefined, core.pbtFailureEntry(failure, NOW));

        const a = recordingGate(failure);
        const applied = await sleepOp(await ctxWith(a.gate), input({ gateRuns }));
        expect(a.seen).toEqual([gateRuns]);
        expect(!applied.ok && applied.error.code).toBe("PBT_GATE_FAILED");
        expect(!applied.ok && applied.error.detail).toMatchObject({
          propertyId: failure.propertyId,
          seed: failure.seed,
          counterexample: failure.counterexample,
        });
        const after = listFiles();
        for (const [k, v] of original) expect(after.get(k)).toBe(v);
        expect([...after.keys()].filter((k) => !original.has(k))).toEqual([PBT_FAILURES_REL]);
        expect(after.get(PBT_FAILURES_REL)).toBe(expected);
        expect(existsSync(join(dir, ".kiro/lethe/backup"))).toBe(false);

        restore();
        const d = recordingGate(failure);
        const dry = await sleepOp(await ctxWith(d.gate), input({ apply: false, gateRuns }));
        expect(d.seen).toEqual([gateRuns]);
        expect(dry.ok && dry.value.pbtGate).toBe("failed");
        expect(dry.ok && dry.value.applied).toBe(false);
        expect(dry.ok && dry.value.gateFailure).toEqual({
          propertyId: failure.propertyId,
          seed: failure.seed,
          counterexample: failure.counterexample,
        });
        const afterDry = listFiles();
        for (const [k, v] of original) expect(afterDry.get(k)).toBe(v);
        expect(afterDry.get(PBT_FAILURES_REL)).toBe(expected);
        expect(existsSync(join(dir, ".kiro/lethe/backup"))).toBe(false);
      }),
    );
  }, 600_000);
});

describe("sleepOp skipGate and malformed failure log", () => {
  const failure: GateFailure = { status: "failed", propertyId: "P3", seed: 5, counterexample: { a: 1 }, message: "m" };

  it("skipGate with apply is INVALID_INPUT and never calls the runner", async () => {
    restore();
    const g = recordingGate(failure);
    const r = await sleepOp(await ctxWith(g.gate), input({ skipGate: true }));
    expect(!r.ok && r.error.code).toBe("INVALID_INPUT");
    expect(g.seen).toEqual([]);
    expect(listFiles()).toEqual(original);
  });

  it("skipGate dry-run reports skipped, never calls the runner and writes nothing", async () => {
    restore();
    const g = recordingGate(failure);
    const r = await sleepOp(await ctxWith(g.gate), input({ apply: false, skipGate: true }));
    expect(r.ok && r.value.pbtGate).toBe("skipped");
    expect(r.ok && r.value.gateFailure).toBeUndefined();
    expect(g.seen).toEqual([]);
    expect(listFiles()).toEqual(original);
  });

  it("a malformed existing pbt-failures.json is replaced exactly as core specifies", async () => {
    restore();
    writeFileSync(join(dir, PBT_FAILURES_REL), "{nope");
    const core = await loadPbtFailureCore();
    const expected = core.appendPbtFailure("{nope", core.pbtFailureEntry(failure, NOW));
    const r = await sleepOp(await ctxWith(recordingGate(failure).gate), input());
    expect(!r.ok && r.error.code).toBe("PBT_GATE_FAILED");
    const text = readFileSync(join(dir, PBT_FAILURES_REL), "utf8");
    expect(text).toBe(expected);
    expect(text).not.toContain("{nope");
  });
});
