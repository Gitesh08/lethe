// Unit tests for the path guard with a fake FsProbe (Req 7.2, 7.4, 7.5, REQ-MCP-4).
import { describe, expect, it } from "vitest";
import { guardPath, resolveWorkspace, type FsProbe } from "../src/io/path-guard.js";
import { windowsViolation } from "../src/io/path-guard-win.js";

/** Fake probe over a set of existing paths; `links` maps a path to its real target. */
function fakeProbe(existing: readonly string[], links: Readonly<Record<string, string>> = {}): FsProbe {
  const set = new Set(existing);
  return {
    realpath: (p) => (set.has(p) ? (links[p] ?? p) : undefined),
    isDirectory: (p) => set.has(p),
    exists: (p) => set.has(p),
  };
}

function code(r: ReturnType<typeof guardPath>): string {
  return r.ok ? "ok" : r.error.code;
}

describe("guardPath (posix rules)", () => {
  const root = "/ws/proj";
  const probe = fakeProbe(["/", "/ws", root, "/ws/proj/.kiro"]);
  const g = (rel: string) => guardPath(root, rel, probe, "linux");

  it("accepts plain, nested and not-yet-existing paths", () => {
    expect(g(".kiro/steering/a.md")).toEqual({ ok: true, value: "/ws/proj/.kiro/steering/a.md" });
    expect(g("a/../b.md")).toEqual({ ok: true, value: "/ws/proj/b.md" });
  });

  it("rejects absolute, NUL and dot-dot escapes (Req 7.2)", () => {
    for (const rel of ["/etc/passwd", "\\x", "a\0b", "..", "../x", "a/../../x", "a\\..\\..\\x"]) {
      expect(code(g(rel)), rel).toBe("PATH_ESCAPE");
    }
  });

  it("does not apply Windows rules on other hosts", () => {
    expect(code(g("C:foo"))).toBe("ok");
  });

  it("is case-sensitive on linux", () => {
    expect(code(guardPath("/ws/proj", "../PROJ/x", probe, "linux"))).toBe("PATH_ESCAPE");
  });

  it("rejects a link whose target leaves the root (fake probe)", () => {
    const p = fakeProbe(["/", "/ws", root, "/ws/proj/out", "/elsewhere"], { "/ws/proj/out": "/elsewhere" });
    expect(code(guardPath(root, "out/file.md", p, "linux"))).toBe("PATH_ESCAPE");
  });

  it("fails closed when nothing can be verified", () => {
    expect(code(guardPath(root, "x", fakeProbe([]), "linux"))).toBe("PATH_ESCAPE");
  });
});

describe("guardPath and windowsViolation (Windows rules, Req 7.4 / 7.5)", () => {
  const root = "D:\\Proj\\Lethe";
  const probe = fakeProbe(["D:\\", "D:\\Proj", root]);
  const g = (rel: string) => guardPath(root, rel, probe, "win32");

  it("rejects drive, UNC, device, ADS and trailing dot or space names", () => {
    const bad = ["C:foo", "D:\\x", "\\\\server\\share", "\\\\?\\C:\\x", "\\\\.\\pipe", "a.md:stream", "x.", "a\\b ", "/rooted"];
    for (const rel of bad) expect(code(g(rel)), rel).toBe("PATH_ESCAPE");
  });

  it("accepts ordinary relative paths with either separator", () => {
    expect(g("a/b\\c.md")).toEqual({ ok: true, value: "D:\\Proj\\Lethe\\a\\b\\c.md" });
    expect(windowsViolation("a\\..\\b")).toBeUndefined();
  });

  it("compares the workspace prefix case-insensitively", () => {
    const lower = fakeProbe(["D:\\", "D:\\proj", "D:\\proj\\lethe"]);
    // `..` out of lethe then back in with different case names the same workspace.
    expect(code(guardPath("D:\\proj\\lethe", "..\\Lethe\\x.md", lower, "win32"))).toBe("ok");
    expect(code(guardPath("D:\\proj\\lethe", "..\\other\\x.md", lower, "win32"))).toBe("PATH_ESCAPE");
    const real = fakeProbe(["D:\\", "D:\\proj", "D:\\proj\\lethe", "D:\\PROJ\\LETHE\\sub"]);
    expect(code(guardPath("D:\\proj\\lethe", "sub", real, "win32"))).toBe("ok");
  });

  it("resolveWorkspace treats D:\\PROJ\\Lethe\\.. and d:\\proj\\lethe consistently", () => {
    const p: FsProbe = {
      realpath: (x) => (x.toLowerCase().replace(/\\+$/, "") === "d:\\proj\\lethe" ? "d:\\proj\\lethe" : undefined),
      isDirectory: () => true,
      exists: () => true,
    };
    expect(resolveWorkspace("D:\\PROJ\\Lethe", p, "win32")).toEqual({ ok: true, value: "d:\\proj\\lethe" });
    const parent = resolveWorkspace("D:\\PROJ\\Lethe\\..", p, "win32");
    expect(parent.ok).toBe(false);
    // A path inside the workspace written with another case is still confined.
    expect(code(guardPath("d:\\proj\\lethe", "a.md", fakeProbe(["d:\\", "d:\\proj", "d:\\proj\\lethe"]), "win32"))).toBe("ok");
  });
});

describe("resolveWorkspace", () => {
  const probe = fakeProbe(["/ws"]);
  it("rejects NUL, relative, missing and non-directory workspaces as INVALID_INPUT", () => {
    const file: FsProbe = { realpath: (p) => p, isDirectory: () => false, exists: () => true };
    const cases: Array<[string, FsProbe]> = [["/w\0s", probe], ["rel/ws", probe], ["/missing", probe], ["/ws", file]];
    for (const [ws, pr] of cases) {
      const r = resolveWorkspace(ws, pr, "linux");
      expect(r.ok ? "ok" : r.error.code, ws).toBe("INVALID_INPUT");
    }
  });

  it("returns the real path once", () => {
    const linked = fakeProbe(["/ws", "/real"], { "/ws": "/real" });
    expect(resolveWorkspace("/ws", linked, "linux")).toEqual({ ok: true, value: "/real" });
  });
});
