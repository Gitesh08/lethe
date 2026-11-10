// PBT gate seam (Req 14). This file holds only the interface: it must not statically import
// "@lethe/core/properties" (fast-check stays unloaded until a gate actually runs, Req 14.6).
// `defaultGateRunner` dynamically imports the properties module inside its body.
import type { LetheConfig } from "@lethe/core";
import type { GateFailure, PbtFailureCore } from "../persist/pbt-failures.js";

export type GateOutcome =
  | { readonly status: "passed"; readonly ran: number; readonly numRuns: number }
  | { readonly status: "failed"; readonly failure: GateFailure };

export type GateRunner = (cfg: LetheConfig, numRuns: number) => Promise<GateOutcome>;

/** Core's failure-record helpers, loaded on demand (the only place besides defaultGateRunner that loads fast-check). */
export async function loadPbtFailureCore(): Promise<PbtFailureCore<unknown>> {
  const m = await import("@lethe/core/properties");
  return {
    pbtFailureEntry: (r, at) => m.pbtFailureEntry({ ...r }, at),
    appendPbtFailure: (text, entry) => m.appendPbtFailure(text, entry as ReturnType<typeof m.pbtFailureEntry>),
  };
}

/** Production runner: core's property gate, imported dynamically so fast-check loads only when a gate runs. */
export const defaultGateRunner: GateRunner = async (cfg, numRuns) => {
  const m = await import("@lethe/core/properties");
  const r = await m.runPbtGate(cfg, { numRuns });
  switch (r.status) {
    case "passed":
      return { status: "passed", ran: r.ran, numRuns: r.numRuns };
    case "failed":
      return { status: "failed", failure: r };
    default: {
      const unreachable: never = r;
      throw new Error(`unexpected gate status: ${JSON.stringify(unreachable)}`);
    }
  }
};

/** Default until a real runner is wired: fails loudly instead of silently skipping the gate. */
export const unconfiguredGate: GateRunner = () =>
  Promise.reject(new Error("no PBT gate runner configured"));

/** Deterministic runner for tests and for transports that inject their own gate. */
export function stubGate(outcome: "passed" | GateFailure): GateRunner {
  return (_cfg, numRuns) =>
    Promise.resolve(
      outcome === "passed"
        ? { status: "passed", ran: 12, numRuns }
        : { status: "failed", failure: outcome },
    );
}
