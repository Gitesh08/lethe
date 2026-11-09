// Does a ledger event reinforce an engram? (REQ-DEC-5)
//   task_passed:           glob match on filesTouched OR cited id OR cited specLink
//   spec_cited/manual_pin: cited id OR cited specLink (never via globs)
// Refs: REQ-DEC-5

import type { EngramNode, LedgerEvent } from "../types.js";
import { compileGlob, normalizePath, testGlob } from "./glob.js";

/** An event with its paths normalised and citations indexed once. */
export interface PreparedEvent {
  readonly ev: LedgerEvent;
  readonly files: readonly string[];
  readonly cited: ReadonlySet<string>;
}

export type GlobCompiler = (pattern: string) => RegExp | null;

export function prepareEvent(ev: LedgerEvent): PreparedEvent {
  return {
    ev,
    files: (ev.filesTouched ?? []).map(normalizePath),
    cited: new Set(ev.cited ?? []),
  };
}

export function citesNode(node: EngramNode, cited: ReadonlySet<string>): boolean {
  if (cited.size === 0) return false;
  return cited.has(node.id) || node.specLinks.some((s) => cited.has(s));
}

function touchesGlobs(node: EngramNode, files: readonly string[], compile: GlobCompiler): boolean {
  if (files.length === 0) return false;
  for (const pattern of node.globs) {
    const re = compile(pattern);
    if (re !== null && files.some((f) => testGlob(re, f))) return true;
  }
  return false;
}

export function eventMatchesPrepared(
  node: EngramNode,
  pe: PreparedEvent,
  compile: GlobCompiler = compileGlob,
): boolean {
  if (citesNode(node, pe.cited)) return true;
  return pe.ev.type === "task_passed" && touchesGlobs(node, pe.files, compile);
}

export function eventMatches(node: EngramNode, ev: LedgerEvent): boolean {
  return eventMatchesPrepared(node, prepareEvent(ev));
}
