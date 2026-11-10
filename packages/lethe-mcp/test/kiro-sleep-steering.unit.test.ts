// Token budget + content checks for the manual /lethe-sleep steering file.
// Refs: Req 16.1, Req 16.2, Req 16.3, REQ-HOK-3

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, parseDocument } from "@lethe/core";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REL = ".kiro/steering/lethe-sleep.md";
const text = readFileSync(resolve(root, REL), "utf8");
const FRONT = "---\ninclusion: manual\n---";
const MAX_TOKENS = 600;

describe("lethe-sleep.md steering file", () => {
  it("starts with exactly the manual-inclusion front matter (LF)", () => {
    expect(text.startsWith(`${FRONT}\n`)).toBe(true);
    expect(text.includes("\r")).toBe(false);
  });

  it("parses with core's parseDocument and stays within the token cap", () => {
    const parsed = parseDocument(REL, text, DEFAULT_CONFIG);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.frontmatter).toBeDefined();
    // Core's token function is not exported; its rule is ceil(chars / 4) (parse/document.ts).
    // The file has only an H1 and no H2 sections, so core yields no engrams to sum;
    // when it does, each engram's tokens must follow the same rule.
    for (const e of parsed.value.engrams) expect(e.tokens).toBe(Math.ceil(e.body.length / 4));
    const body = text.slice(FRONT.length + 1);
    expect(Math.ceil(body.length / 4)).toBeLessThanOrEqual(MAX_TOKENS);
    expect(Math.ceil(text.length / 4)).toBeLessThanOrEqual(MAX_TOKENS);
  });

  it.each([
    "lethe_detect_contradictions",
    "apply: false",
    "apply: true",
    "pbtGate",
    "skipGate",
    "backupPath",
    "lethe_resurrect_engram",
  ])("mentions %s", (needle) => {
    expect(text).toContain(needle);
  });
});
