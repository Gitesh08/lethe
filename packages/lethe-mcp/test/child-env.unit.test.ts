import { describe, expect, it } from "vitest";
import { childEnv } from "../src/io/child-env.js";

// Validates: Requirements 11.1, 12.2

describe("childEnv", () => {
  it("drops variables that are not on the allow-list", () => {
    const env = childEnv({ PATH: "/bin", FOO: "x", NODE_OPTIONS: "--inspect", LANG: "en_US" });
    expect(env["PATH"]).toBe("/bin");
    expect(env["LANG"]).toBe("en_US");
    expect(env["FOO"]).toBeUndefined();
    expect(env["NODE_OPTIONS"]).toBeUndefined();
  });

  it("never forwards names containing TOKEN or SECRET, in any case", () => {
    const env = childEnv({
      GITHUB_TOKEN: "a",
      my_secret: "b",
      AWS_SECRET_ACCESS_KEY: "c",
      PATH_TOKEN: "d",
      HOME_SECRET: "e",
      HOME: "/home/u",
    });
    const names = Object.keys(env);
    expect(names.filter((n) => /token|secret/i.test(n))).toEqual([]);
    expect(env["HOME"]).toBe("/home/u");
  });

  it("forwards LC_* names case-insensitively but forces LC_ALL=C and git settings", () => {
    const env = childEnv({ LC_CTYPE: "x", lc_all: "y", GIT_TERMINAL_PROMPT: "1" });
    expect(env["LC_CTYPE"]).toBe("x");
    expect(env["LC_ALL"]).toBe("C");
    expect(env["lc_all"]).toBeUndefined();
    expect(env["GIT_TERMINAL_PROMPT"]).toBe("0");
    expect(env["GIT_OPTIONAL_LOCKS"]).toBe("0");
  });

  it("skips undefined values", () => {
    expect(childEnv({ PATH: undefined })["PATH"]).toBeUndefined();
  });
});
