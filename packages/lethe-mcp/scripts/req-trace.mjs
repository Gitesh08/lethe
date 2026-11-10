// Requirement traceability: scans packages/lethe-mcp/test/**/*.ts and prints a
// markdown table mapping each requirement id to the test files citing it (Req 21.9).
//
// Recognised references (all matched anywhere in file text, comments included):
//   REQ-ABC-12            REQ-MCP-1..6 expands to REQ-MCP-1 .. REQ-MCP-6
//   NFR-3, INV-5          (ranges like INV-1..4 expand too)
//   Req 13.3, Req 13      listed as "Req 13.3" / "Req 13"
// Continuation rule for Req lists: after "Req N[.M]" (or "Reqs"), further items
// separated by ",", "and", "&" or "/" are attributed to Req when they are written
// N.M (dotted), e.g. "Refs: Req 13.3, 13.4, 13.5" -> Req 13.3, 13.4, 13.5.
// Bare continuation numbers (no dot) are NOT taken, to avoid counting prose numbers.
// Ranges: "18.1-18.7" or "18.1-7" expand over the minor number within one major;
// a range across different majors yields just its two endpoints.
//
// Output is deterministic: ids sorted naturally (Req, REQ, NFR, INV groups; numeric
// parts compared numerically), paths by code unit, "/" separators, LF, one final "\n".
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GROUP_ORDER = { Req: 0, REQ: 1, NFR: 2, INV: 3 };
const MAX_RANGE = 200;

const ITEM = String.raw`\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?`;
const CONT = String.raw`\d+\.\d+(?:-\d+(?:\.\d+)?)?`;
const REQ_LIST = new RegExp(String.raw`\bReqs? (${ITEM}(?:(?:\s*,\s*|\s+and\s+|\s*&\s*|\s*/\s*)${CONT})*)`, "g");
const REQ_ID = /\bREQ-([A-Z]+)-(\d+)(?:\.\.(\d+))?/g;
const SHORT_ID = /\b(NFR|INV)-(\d+)(?:\.\.(\d+))?/g;

function span(from, to) {
  const out = [];
  if (to < from || to - from > MAX_RANGE) return [from, to];
  for (let n = from; n <= to; n += 1) out.push(n);
  return out;
}

function expandReqItem(item) {
  const m = /^(\d+)(?:\.(\d+))?(?:-(\d+)(?:\.(\d+))?)?$/.exec(item);
  if (m === null) return [];
  const [, major, minor, end1, end2] = m;
  if (minor === undefined) return [`Req ${major}`];
  if (end1 === undefined) return [`Req ${major}.${minor}`];
  if (end2 === undefined) return span(Number(minor), Number(end1)).map((n) => `Req ${major}.${n}`);
  if (end1 !== major) return [`Req ${major}.${minor}`, `Req ${end1}.${end2}`];
  return span(Number(minor), Number(end2)).map((n) => `Req ${major}.${n}`);
}

/** Pure: all requirement ids referenced in `text` (deduplicated, unsorted). */
export function extractIds(text) {
  const ids = new Set();
  for (const m of text.matchAll(REQ_ID)) {
    const last = m[3] === undefined ? Number(m[2]) : Number(m[3]);
    for (const n of span(Number(m[2]), last)) ids.add(`REQ-${m[1]}-${n}`);
  }
  for (const m of text.matchAll(SHORT_ID)) {
    const last = m[3] === undefined ? Number(m[2]) : Number(m[3]);
    for (const n of span(Number(m[2]), last)) ids.add(`${m[1]}-${n}`);
  }
  for (const m of text.matchAll(REQ_LIST)) {
    for (const part of m[1].split(/\s*,\s*|\s+and\s+|\s*&\s*|\s*\/\s*/)) {
      for (const id of expandReqItem(part.trim())) ids.add(id);
    }
  }
  return [...ids];
}

function idKey(id) {
  if (id.startsWith("Req ")) return { g: GROUP_ORDER.Req, p: "", n: id.slice(4).split(".").map(Number) };
  const parts = id.split("-");
  const g = GROUP_ORDER[parts[0]] ?? 9;
  if (parts[0] === "REQ") return { g, p: parts[1] ?? "", n: [Number(parts[2])] };
  return { g, p: "", n: [Number(parts[1])] };
}

function cmpCode(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpIds(a, b) {
  const ka = idKey(a);
  const kb = idKey(b);
  if (ka.g !== kb.g) return ka.g - kb.g;
  if (ka.p !== kb.p) return cmpCode(ka.p, kb.p);
  for (let i = 0; i < Math.max(ka.n.length, kb.n.length); i += 1) {
    const x = ka.n[i] ?? -1;
    const y = kb.n[i] ?? -1;
    if (x !== y) return x - y;
  }
  return cmpCode(a, b);
}

/** Pure: markdown table of requirement id -> citing test files. `files` = [{path, text}]. */
export function traceTable(files) {
  const byId = new Map();
  for (const f of files) {
    const path = f.path.replace(/\\/g, "/");
    for (const id of extractIds(f.text)) {
      const set = byId.get(id) ?? new Set();
      set.add(path);
      byId.set(id, set);
    }
  }
  const rows = [...byId.keys()].sort(cmpIds).map((id) => {
    const paths = [...(byId.get(id) ?? [])].sort(cmpCode);
    return `| ${id} | ${paths.join(", ")} |`;
  });
  return `${["| Requirement | Test files |", "|---|---|", ...rows].join("\n")}\n`;
}

/** Reads every `*.ts` under `<root>/test`; paths are relative to `root`, "/"-separated, code-unit sorted. */
export function collectTestFiles(root) {
  const out = [];
  const walk = (dirAbs, dirRel) => {
    for (const e of readdirSync(dirAbs, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const rel = `${dirRel}/${e.name}`;
      if (e.isDirectory()) walk(resolve(dirAbs, e.name), rel);
      else if (e.isFile() && e.name.endsWith(".ts")) {
        out.push({ path: rel, text: readFileSync(resolve(dirAbs, e.name), "utf8") });
      }
    }
  };
  walk(resolve(root, "test"), "test");
  return out.sort((a, b) => cmpCode(a.path, b.path));
}

/** Package root (packages/lethe-mcp), resolved from this script's location. */
export function defaultRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(traceTable(collectTestFiles(defaultRoot())));
}
