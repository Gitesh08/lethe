// Covers: REQ-CON-2..6, P11
import { describe, expect, it } from "vitest";
import { applyDefeats } from "../src/contradiction/defeat.js";
import { detectContradictions } from "../src/contradiction/detect.js";
import type { Axis, ContradictionReport, ScoredEngram, SpecInvariant } from "../src/types.js";

interface Opts {
  readonly retention?: number;
  readonly commit?: number;
  readonly prot?: boolean;
}

function mk(id: string, body: string, o: Opts = {}): ScoredEngram {
  const retention = o.retention ?? 0.7;
  return {
    node: {
      id, file: "f.md", headingPath: [id], body, contentHash: id, tokens: 10,
      globs: [], specLinks: [], pinned: false, span: { start: 0, end: body.length },
    },
    state: { id, stability: 5, lastReinforcedCommit: o.commit ?? 1, lastReinforcedAt: "", reinforcements: 0 },
    deltaC: 0, weight: 1, retention, rawRetention: retention,
    tier: "hot", status: "active", protected: o.prot ?? false,
  };
}

function run(
  scored: readonly ScoredEngram[],
  specs: readonly SpecInvariant[] = [],
  ont?: readonly Axis[],
): readonly ContradictionReport[] {
  const r = detectContradictions(scored, specs, ont);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

const rx = (o?: Opts): ScoredEngram => mk("a-rx", "Use RxJS BehaviorSubject for state", o);
const sig = (o?: Opts): ScoredEngram => mk("b-sig", "Use signals for state", o);

describe("detectContradictions", () => {
  it("returns ok([]) when nothing conflicts", () => {
    expect(run([mk("x", "Use vitest."), mk("y", "Write short files.")])).toEqual([]);
  });

  it("reports the PRD demo conflict, resolved by retention", () => {
    const reports = run([rx({ retention: 0.4 }), sig({ retention: 0.9 })]);
    expect(reports).toHaveLength(1);
    const r = reports[0];
    expect(r?.axis).toBe("state-management");
    expect(r?.a.stance).toBe("state:rxjs-subjects");
    expect(r?.b.stance).toBe("state:signals");
    expect(r?.resolution).toEqual({ kind: "resolved", winner: "b-sig", loser: "a-rx", reason: "retention" });
  });

  it("resolves ties by recency", () => {
    const r = run([rx({ commit: 9 }), sig({ commit: 3 })]);
    expect(r[0]?.resolution).toEqual({ kind: "resolved", winner: "a-rx", loser: "b-sig", reason: "recency" });
  });

  it("resolves full ties by id", () => {
    const r = run([rx(), sig()]);
    expect(r[0]?.resolution).toEqual({ kind: "resolved", winner: "a-rx", loser: "b-sig", reason: "id" });
  });

  it("detects +A vs -A on the css axis", () => {
    const r = run([mk("u", "Use Tailwind."), mk("v", "Do not use Tailwind.")]);
    expect(r).toHaveLength(1);
    expect(r[0]?.axis).toBe("css-approach");
    expect(r.map((x) => [x.a.stance, x.b.stance])).toEqual([["css:tailwind", "not:css:tailwind"]]);
  });

  it("detects tailwind vs pure css", () => {
    const r = run([mk("u", "Use Tailwind."), mk("v", "Use pure CSS only.")]);
    expect(r).toHaveLength(1);
    expect(r[0]?.axis).toBe("css-approach");
  });

  it("does not flag (-A,-B) or (-A,+B)", () => {
    expect(run([mk("u", "Do not use Tailwind."), mk("v", "Never use pure CSS.")])).toEqual([]);
    expect(run([mk("u", "Do not use Tailwind."), mk("v", "Use pure CSS.")])).toEqual([]);
  });

  it("never conflicts an engram with itself", () => {
    expect(run([mk("solo", "Use RxJS. Use signals.")])).toEqual([]);
  });

  it("emits exactly one report per pair despite many matching sentences", () => {
    const x = mk("x", "Use RxJS here. Also use RxJS subjects. RxJS is great.");
    const y = mk("y", "Use signals. Signals are great. Prefer signals.");
    expect(run([x, y])).toHaveLength(1);
  });

  it("both protected => unresolvable and nobody defeated", () => {
    const s = [rx({ prot: true }), sig({ prot: true })];
    const reports = run(s);
    expect(reports[0]?.resolution).toEqual({ kind: "unresolvable", reason: "both-protected" });
    expect(applyDefeats(s, reports).map((e) => e.status)).toEqual(["active", "active"]);
  });

  it("one protected => the other is defeated", () => {
    const s = [rx({ prot: true, retention: 0.1 }), sig({ retention: 0.99 })];
    const reports = run(s);
    expect(reports[0]?.resolution).toMatchObject({ kind: "resolved", winner: "a-rx", loser: "b-sig" });
    const out = applyDefeats(s, reports);
    expect(out.map((e) => e.status)).toEqual(["active", "defeated"]);
    expect(s[1]?.status).toBe("active");
  });

  it("propagates invalid user ontology and emits no reports", () => {
    const bad: Axis[] = [{ id: "x", description: "", stances: [
      { id: "x:a", label: "a", patterns: ["("], negationAware: true },
    ] }];
    const r = detectContradictions([rx(), sig()], [], bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ONTOLOGY_INVALID_PATTERN");
  });

  it("supports a user axis and stance replacement", () => {
    const extra: Axis[] = [
      { id: "db", description: "database", stances: [
        { id: "db:pg", label: "pg", patterns: ["\\bpostgres\\b"], negationAware: true },
        { id: "db:my", label: "my", patterns: ["\\bmysql\\b"], negationAware: true },
      ] },
      { id: "state-management", description: "", stances: [
        { id: "state:signals", label: "s", patterns: ["\\bpreact signals\\b"], negationAware: true },
      ] },
    ];
    const db = run([mk("p", "Use Postgres."), mk("q", "Use MySQL.")], [], extra);
    expect(db.map((r) => r.axis)).toEqual(["db"]);
    expect(run([rx(), sig()], [], extra)).toEqual([]);
  });

  it("lets an active spec defeat a conflicting engram; ignores inactive specs", () => {
    const spec = (active: boolean): SpecInvariant =>
      ({ specName: "core", active, requirementIds: [], stances: ["state:signals", "bogus:x"] });
    const r = run([rx()], [spec(true)]);
    expect(r).toHaveLength(1);
    expect(r[0]?.resolution).toEqual({ kind: "resolved", winner: "spec:core", loser: "a-rx", reason: "spec" });
    expect(r[0]?.b.evidence).toBe("spec stance state:signals");
    expect(run([rx()], [spec(false)])).toEqual([]);
    const defeated = applyDefeats([rx()], r);
    expect(defeated[0]?.status).toBe("defeated");
  });

  it("does not conflict two spec sides", () => {
    const s = (n: string, st: string): SpecInvariant => ({ specName: n, active: true, requirementIds: [], stances: [st] });
    expect(run([], [s("a", "state:signals"), s("b", "state:redux")])).toEqual([]);
  });

  it("sorts by (axis, a.id, b.id) and ignores input order", () => {
    const all = [
      mk("m", "Use Tailwind."), mk("n", "Use pure CSS."),
      rx(), sig(), mk("c-sig", "Use signals."),
    ];
    const base = run(all);
    const keys = base.map((r) => `${r.axis}|${r.a.id}|${r.b.id}`);
    expect(keys).toEqual([...keys].sort());
    expect(base.length).toBeGreaterThan(2);
    expect(run([...all].reverse())).toEqual(base);
    expect(run([...all.slice(2), ...all.slice(0, 2)])).toEqual(base);
  });

  it("merges same-named active specs: one report per (axis, a, b) triple (P11 regression)", () => {
    const spec = (stances: string[]): SpecInvariant => ({ specName: "spec-0", active: true, requirementIds: [], stances });
    const e = mk("c27", "Use Vitest.");
    const reports = run([e], [spec(["test:jest"]), spec(["test:mocha"])]);
    expect(reports).toHaveLength(1);
    expect(run([e], [spec(["test:mocha"]), spec(["test:jest"])])).toEqual(reports);
  });
  it("does not mutate frozen inputs", () => {
    const s = [rx(), sig()].map((e) => Object.freeze({ ...e, node: Object.freeze(e.node), state: Object.freeze(e.state) }));
    Object.freeze(s);
    const reports = run(s);
    expect(() => applyDefeats(s, reports)).not.toThrow();
    expect(s.map((e) => e.status)).toEqual(["active", "active"]);
  });
});
