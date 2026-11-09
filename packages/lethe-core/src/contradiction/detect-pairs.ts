/**
 * Pairwise conflict search on a single axis. Covers: REQ-CON-2, REQ-CON-3, P11.
 *
 * Reported stance strings: the stance id for a "+" match, and "not:<stanceId>"
 * for a "-" (negated) match, so polarity is visible in the report.
 */
import type { ContradictionReport, ScoredEngram, StanceMatch } from "../types.js";
import { resolveContradiction } from "./resolve.js";

/** One engram (or synthetic spec side) with its matches restricted to one axis. */
export interface AxisSide {
  readonly engram: ScoredEngram;
  readonly spec: boolean;
  readonly matches: readonly StanceMatch[];
}

interface Combo {
  readonly sl: string;
  readonly el: string;
  readonly sh: string;
  readonly eh: string;
}

export function reportedStance(m: StanceMatch): string {
  return m.polarity === "-" ? `not:${m.stanceId}` : m.stanceId;
}

/** (+A,+B) A!=B and (+A,-A)/(-A,+A) conflict; everything else does not. */
function conflicts(m1: StanceMatch, m2: StanceMatch): boolean {
  if (m1.stanceId === m2.stanceId) return m1.polarity !== m2.polarity;
  return m1.polarity === "+" && m2.polarity === "+";
}

/** Total order on combos using plain `<` string comparison. */
function comboBefore(p: Combo, q: Combo): boolean {
  if (p.sl !== q.sl) return p.sl < q.sl;
  if (p.el !== q.el) return p.el < q.el;
  if (p.sh !== q.sh) return p.sh < q.sh;
  return p.eh < q.eh;
}

function bestCombo(lo: AxisSide, hi: AxisSide): Combo | undefined {
  let best: Combo | undefined;
  for (const ml of lo.matches) {
    for (const mh of hi.matches) {
      if (!conflicts(ml, mh)) continue;
      const c: Combo = { sl: reportedStance(ml), el: ml.evidence, sh: reportedStance(mh), eh: mh.evidence };
      if (best === undefined || comboBefore(c, best)) best = c;
    }
  }
  return best;
}

/** `sides` must be sorted by engram id ascending. Emits at most one report per pair. */
export function pairReports(axisId: string, sides: readonly AxisSide[]): readonly ContradictionReport[] {
  const out: ContradictionReport[] = [];
  for (let i = 0; i < sides.length; i++) {
    const lo = sides[i];
    if (lo === undefined) continue;
    for (let j = i + 1; j < sides.length; j++) {
      const hi = sides[j];
      if (hi === undefined || (lo.spec && hi.spec)) continue;
      if (lo.engram.node.id === hi.engram.node.id) continue;
      const c = bestCombo(lo, hi);
      if (c === undefined) continue;
      out.push(resolveContradiction(lo.engram, hi.engram, axisId, c.sl, c.sh, c.el, c.eh));
    }
  }
  return out;
}
