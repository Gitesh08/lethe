// Task 12.4: .kiro/hooks/*.json follow the verified v1 format. Refs: Req 15.4, Req 13.6, REQ-HOK-1, REQ-HOK-2
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const hooksDir = resolve(repoRoot, ".kiro", "hooks");

const TRIGGERS = [
  "SessionStart",
  "Stop",
  "UserPromptSubmit",
  "PreTaskExec",
  "PostTaskExec",
  "PreToolUse",
  "PostToolUse",
  "PostFileCreate",
  "PostFileSave",
  "PostFileDelete",
] as const;

const regexString = z.string().refine((s) => {
  try {
    new RegExp(s);
    return true;
  } catch {
    return false;
  }
}, "matcher must compile as a regular expression");

const Action = z.union([
  z.object({ type: z.literal("command"), command: z.string().min(1) }).strict(),
  z.object({ type: z.literal("agent"), prompt: z.string().min(1) }).strict(),
]);

const Hook = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    trigger: z.enum(TRIGGERS),
    matcher: regexString.optional(),
    action: Action,
    timeout: z.number().min(0).optional(),
    enabled: z.boolean().optional(),
    confirm: z.boolean().optional(),
  })
  .strict();

const HookFile = z
  .object({ version: z.literal("v1"), hooks: z.array(Hook).min(1) })
  .strict();

const validHook = {
  name: "h",
  trigger: "PostFileSave",
  action: { type: "command", command: "node x" },
};
const wrap = (hook: object): unknown => ({ version: "v1", hooks: [hook] });

function walk(dir: string, out: string[]): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = readdirSync(hooksDir).filter((f) => f.endsWith(".json")).sort();
const loaded = files.map((f) => ({
  file: f,
  json: JSON.parse(readFileSync(join(hooksDir, f), "utf8")) as unknown,
}));
const allHooks = loaded.flatMap((l) => HookFile.parse(l.json).hooks);

describe(".kiro/hooks/*.json", () => {
  it("has the three expected hook files", () => {
    expect(files).toEqual(["lethe-check-on-save.json", "lethe-probe.json", "lethe-record-on-task.json"]);
  });

  it.each(loaded.map((l) => [l.file, l.json] as const))("%s matches the v1 schema", (_f, json) => {
    expect(HookFile.safeParse(json).success).toBe(true);
  });

  it("leaves no legacy *.kiro.hook file anywhere in the repo", () => {
    const legacy = walk(repoRoot, []).filter((p) => p.endsWith(".kiro.hook"));
    expect(legacy).toEqual([]);
  });

  it("no hook command uses --block", () => {
    for (const h of allHooks) {
      if (h.action.type === "command") expect(h.action.command).not.toContain("--block");
    }
  });

  it("every command targets packages/lethe-mcp/dist/lethe.mjs", () => {
    for (const h of allHooks) {
      expect(h.action.type).toBe("command");
      if (h.action.type === "command") {
        expect(h.action.command).toContain("packages/lethe-mcp/dist/lethe.mjs");
      }
    }
  });

  it("the check matcher matches steering/specs markdown and not source files", () => {
    const check = allHooks.find((h) => h.name === "lethe-check-on-save");
    expect(check?.matcher).toBeDefined();
    const re = new RegExp(check?.matcher ?? "");
    expect(re.test(".kiro/steering/a.md")).toBe(true);
    expect(re.test(".kiro\\specs\\x\\design.md")).toBe(true);
    expect(re.test("src/a.ts")).toBe(false);
  });
});

describe("hook schema bites", () => {
  it("accepts a minimal valid hook", () => {
    expect(HookFile.safeParse(wrap(validHook)).success).toBe(true);
  });

  it.each([
    ["version v2", { version: "v2", hooks: [validHook] }],
    ["empty hooks", { version: "v1", hooks: [] }],
    ["lowercase trigger", wrap({ ...validHook, trigger: "postFileSave" })],
    ["bad regex matcher", wrap({ ...validHook, matcher: "(" })],
    ["empty command", wrap({ ...validHook, action: { type: "command", command: "" } })],
    ["empty agent prompt", wrap({ ...validHook, action: { type: "agent", prompt: "" } })],
    ["negative timeout", wrap({ ...validHook, timeout: -1 })],
    ["non-boolean enabled", wrap({ ...validHook, enabled: "no" })],
  ])("rejects %s", (_n, value) => {
    expect(HookFile.safeParse(value).success).toBe(false);
  });
});
