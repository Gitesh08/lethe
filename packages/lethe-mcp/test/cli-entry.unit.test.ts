// cli.ts is importable without side effects; --version/--help flow through main() with exit 0.
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

describe("cli entry", () => {
  it("imports without running or exiting, and exposes main", () => {
    expect(typeof main).toBe("function");
  });

  it("returns 0 for --version and --help", async () => {
    expect(await main(["--version"])).toBe(0);
    expect(await main(["--help"])).toBe(0);
  });
});
