// Collects .kiro/steering (and optionally .kiro/specs) markdown and parses it with core (Req 10.1, 10.2, REQ-PAR-5).
import { ok, parseDocument, type EngramNode, type LetheConfig, type ParsedDoc, type Result } from "@lethe/core";
import { diagnostic, type Diagnostic } from "../envelope/diagnostics.js";
import type { ToolError } from "../envelope/errors.js";
import type { WorkspaceFs } from "../io/workspace-fs.js";

export const STEERING_DIR = ".kiro/steering";
export const SPECS_DIR = ".kiro/specs";
/** Files larger than this many bytes are skipped (exactly 1 MiB still loads). */
export const MAX_MARKDOWN_BYTES = 1_048_576;

export interface CollectedSteering {
  /** Workspace-relative `/` path -> exact text (BOM and newlines untouched). Skipped files are absent. */
  readonly steeringFiles: ReadonlyMap<string, string>;
  readonly specFiles: ReadonlyMap<string, string>;
  readonly docs: ReadonlyMap<string, ParsedDoc>;
  readonly engrams: readonly EngramNode[];
  readonly specEngrams: readonly EngramNode[];
  /** Paths that were oversize, not UTF-8, or unparsable: must never be rewritten. Sorted. */
  readonly neverRewrite: readonly string[];
  readonly anySteeringSkipped: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

type Read = { readonly text: string } | { readonly skip: Diagnostic };

function decode(path: string, bytes: Uint8Array): Read {
  if (bytes.byteLength > MAX_MARKDOWN_BYTES) {
    return { skip: diagnostic("FILE_TOO_LARGE", `skipped: ${bytes.byteLength} bytes exceeds 1 MiB`, path) };
  }
  try {
    return { text: utf8.decode(bytes) };
  } catch {
    return { skip: diagnostic("FILE_NOT_UTF8", "skipped: not valid UTF-8", path) };
  }
}

interface Acc {
  readonly files: Map<string, string>;
  readonly engrams: EngramNode[];
  readonly docs: Map<string, ParsedDoc>;
  readonly skipped: string[];
  readonly diagnostics: Diagnostic[];
}

/** Reads, decodes and parses one file into `acc`; skipped files add a Diagnostic and a never-rewrite entry. */
function ingest(acc: Acc, path: string, bytes: Uint8Array, cfg: LetheConfig): boolean {
  const read = decode(path, bytes);
  let bad: Diagnostic | undefined = "skip" in read ? read.skip : undefined;
  if ("text" in read) {
    const parsed = parseDocument(path, read.text, cfg);
    if (parsed.ok) {
      acc.files.set(path, read.text);
      acc.docs.set(path, parsed.value);
      acc.engrams.push(...parsed.value.engrams);
    } else {
      bad = diagnostic("PARSE_SKIPPED", `skipped: ${parsed.error.code}: ${parsed.error.message}`, path);
    }
  }
  if (bad === undefined) return false;
  acc.diagnostics.push(bad);
  acc.skipped.push(path);
  return true;
}

async function collectDir(fsx: WorkspaceFs, dir: string, cfg: LetheConfig, acc: Acc): Promise<Result<boolean, ToolError>> {
  const listed = await fsx.listMarkdown(dir);
  if (!listed.ok) return listed;
  let anySkipped = false;
  for (const path of [...listed.value].sort(byCodeUnits)) {
    const bytes = await fsx.readBytes(path);
    if (!bytes.ok) return bytes;
    if (bytes.value !== undefined && ingest(acc, path, bytes.value, cfg)) anySkipped = true;
  }
  return ok(anySkipped);
}

const newAcc = (): Acc => ({ files: new Map(), engrams: [], docs: new Map(), skipped: [], diagnostics: [] });

/** Collects and parses markdown. Files are visited steering first, then specs, each in code-unit path order. */
export async function collectSteering(
  fsx: WorkspaceFs,
  cfg: LetheConfig,
  opts: { readonly includeSpecs: boolean },
): Promise<Result<CollectedSteering, ToolError>> {
  const st = newAcc();
  const sp = newAcc();
  const steering = await collectDir(fsx, STEERING_DIR, cfg, st);
  if (!steering.ok) return steering;
  if (opts.includeSpecs) {
    const specs = await collectDir(fsx, SPECS_DIR, cfg, sp);
    if (!specs.ok) return specs;
  }
  const docs = new Map([...st.docs, ...sp.docs]);
  return ok({
    steeringFiles: st.files, specFiles: sp.files, docs, engrams: st.engrams, specEngrams: sp.engrams,
    neverRewrite: [...st.skipped, ...sp.skipped].sort(byCodeUnits), anySteeringSkipped: steering.value,
    diagnostics: [...st.diagnostics, ...sp.diagnostics],
  });
}
