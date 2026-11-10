// Hand-written guard turning parsed JSON into core's LedgerEvent (core exports no validator). Refs: Req 10.8, Req 10.9
import type { LedgerEvent } from "@lethe/core";

type EventType = LedgerEvent["type"];

const TYPES: ReadonlySet<string> = new Set(["task_passed", "spec_cited", "manual_pin"]);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isEventType = (v: unknown): v is EventType => typeof v === "string" && TYPES.has(v);
const isIsoish = (v: unknown): v is string => typeof v === "string" && v !== "" && !Number.isNaN(Date.parse(v));
const isCommit = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

/** undefined when absent, null when present but not a string array. */
function optionalStringArray(v: unknown): readonly string[] | undefined | null {
  if (v === undefined) return undefined;
  return isStringArray(v) ? v : null;
}

/** Returns the event, or null when `v` is not a valid LedgerEvent. Unknown keys are dropped. */
export function toLedgerEvent(v: unknown): LedgerEvent | null {
  if (!isRecord(v)) return null;
  const { type, at, commit } = v;
  if (!isEventType(type) || !isIsoish(at) || !isCommit(commit)) return null;
  const files = optionalStringArray(v["filesTouched"]);
  const cited = optionalStringArray(v["cited"]);
  if (files === null || cited === null) return null;
  return {
    type,
    at,
    commit,
    ...(files === undefined ? {} : { filesTouched: files }),
    ...(cited === undefined ? {} : { cited }),
  };
}
