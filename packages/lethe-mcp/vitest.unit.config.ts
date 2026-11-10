import { defineConfig } from "vitest/config";

// Parallel unit pass: everything except timing-sensitive *.perf.test.ts.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/**/*.perf.test.ts", "**/node_modules/**"],
    pool: "forks",
    passWithNoTests: true,
  },
});
