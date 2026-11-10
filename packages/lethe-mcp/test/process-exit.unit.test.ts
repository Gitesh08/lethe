// Req 13.1/19.1: cli.ts is the only module under src that references process.exit.
import { describe, expect, it } from "vitest";
import { loadSources, stripCommentsAndStrings } from "./support/source-files.js";

const EXIT = /\bprocess\s*\.\s*exit\b|\bprocess\s*\[\s*["']exit["']\s*\]/;

describe("process.exit confinement", () => {
  it("is referenced only by cli.ts", () => {
    const hits = loadSources().filter(({ text }) => EXIT.test(stripCommentsAndStrings(text))).map((s) => s.rel);
    expect(hits).toEqual(["cli.ts"]);
  });
});
