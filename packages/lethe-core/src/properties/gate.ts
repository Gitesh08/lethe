// PBT gate: runs P1..P12 sequentially with fc.check (never throws) and reports the first failure.
// File IO for .kiro/lethe/pbt-failures.json lives in lethe-mcp; this module only builds text.
// Refs: REQ-PBT-1, REQ-PBT-3, REQ-PBT-5, INV-7
import fc from "fast-check";
import { toJsonSafe } from "./json-safe.js";
import { p10Partition } from "./p10-partition.js";
import { p11Symmetric } from "./p11-symmetric.js";
import { p12Serialize } from "./p12-serialize.js";
import { p1Range } from "./p1-range.js";
import { p2Monotonic } from "./p2-monotonic.js";
import { p3Reinforce } from "./p3-reinforce.js";
import { p4Protected } from "./p4-protected.js";
import { p5Contradiction } from "./p5-contradiction.js";
import { p6Budget } from "./p6-budget.js";
import { p7Roundtrip } from "./p7-roundtrip.js";
import { p8Idempotent } from "./p8-idempotent.js";
import { p9Determinism } from "./p9-determinism.js";
import type { LetheConfig } from "../types.js";

export type PbtGateResult =
  | { readonly status: "passed"; readonly ran: number; readonly numRuns: number }
  | {
      readonly status: "failed";
      readonly propertyId: string;
      readonly seed: number;
      readonly counterexample: unknown;
      readonly message: string;
    };

export type PbtFailure = Extract<PbtGateResult, { readonly status: "failed" }>;

export interface PbtGateOptions {
  readonly numRuns?: number;
  /** Called before each property starts; `index` is 0-based. */
  readonly onProgress?: (id: string, index: number, total: number) => void;
}

export interface GateEntry {
  readonly id: string;
  readonly factory: () => fc.IRawProperty<unknown>;
}

export const PROPERTY_IDS: readonly string[] = [
  "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "P12",
];

export const DEFAULT_GATE_RUNS = 100;

function gateEntries(cfg: LetheConfig): readonly GateEntry[] {
  return [
    { id: "P1", factory: () => p1Range(cfg) },
    { id: "P2", factory: () => p2Monotonic(cfg) },
    { id: "P3", factory: () => p3Reinforce(cfg) },
    { id: "P4", factory: () => p4Protected(cfg) },
    { id: "P5", factory: () => p5Contradiction(cfg) },
    { id: "P6", factory: () => p6Budget(cfg) },
    { id: "P7", factory: () => p7Roundtrip(cfg) },
    { id: "P8", factory: () => p8Idempotent(cfg) },
    { id: "P9", factory: () => p9Determinism(cfg) },
    { id: "P10", factory: () => p10Partition(cfg) },
    { id: "P11", factory: () => p11Symmetric(cfg) },
    { id: "P12", factory: () => p12Serialize(cfg) },
  ];
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function firstOf(args: unknown): unknown {
  return Array.isArray(args) ? (args as readonly unknown[])[0] : undefined;
}

function checkOne(entry: GateEntry, numRuns: number): PbtFailure | undefined {
  try {
    const result = fc.check(entry.factory(), { numRuns });
    if (result instanceof Promise) {
      return { status: "failed", propertyId: entry.id, seed: 0, counterexample: null, message: "async property not supported in gate" };
    }
    const details = result;
    if (!details.failed) return undefined;
    return {
      status: "failed",
      propertyId: entry.id,
      seed: details.seed,
      counterexample: toJsonSafe(firstOf(details.counterexample)),
      message: messageOf(details.errorInstance ?? `${entry.id} failed after ${details.numRuns} runs`),
    };
  } catch (e: unknown) {
    return {
      status: "failed",
      propertyId: entry.id,
      seed: 0,
      counterexample: null,
      message: `unexpected exception: ${messageOf(e)}`,
    };
  }
}

/** Runs the entries in order; stops at the first failure. Yields between properties. */
export async function runGate(
  entries: readonly GateEntry[],
  numRuns: number,
  onProgress?: PbtGateOptions["onProgress"],
): Promise<PbtGateResult> {
  let ran = 0;
  for (const [index, entry] of entries.entries()) {
    onProgress?.(entry.id, index, entries.length);
    const failure = checkOne(entry, numRuns);
    if (failure !== undefined) return failure;
    ran += 1;
    await Promise.resolve();
  }
  return { status: "passed", ran, numRuns };
}

export function runPbtGate(cfg: LetheConfig, opts?: PbtGateOptions): Promise<PbtGateResult> {
  const numRuns = opts?.numRuns ?? DEFAULT_GATE_RUNS;
  return runGate(gateEntries(cfg), numRuns, opts?.onProgress);
}

export interface PbtFailureEntry {
  readonly propertyId: string;
  readonly seed: number;
  readonly counterexample: unknown;
  readonly failedAt: string;
}

/** JSON-safe record for .kiro/lethe/pbt-failures.json (fixed key order). */
export function pbtFailureEntry(result: PbtFailure, atISO: string): PbtFailureEntry {
  return {
    propertyId: result.propertyId,
    seed: result.seed,
    counterexample: toJsonSafe(result.counterexample),
    failedAt: atISO,
  };
}

function parseExisting(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const rec = parsed as Record<string, unknown>;
    return Array.isArray(rec["failures"]) ? rec : undefined;
  } catch {
    return undefined;
  }
}

/** New file text: appends to a valid existing file, otherwise starts fresh. Pure; no IO. */
export function appendPbtFailure(existingText: string | undefined, entry: PbtFailureEntry): string {
  const existing = parseExisting(existingText);
  const prior = existing === undefined ? [] : (existing["failures"] as readonly unknown[]);
  const next = { ...(existing ?? {}), failures: [...prior, entry] };
  return `${JSON.stringify(next, null, 2)}\n`;
}
