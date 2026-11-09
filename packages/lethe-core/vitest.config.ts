import { defineConfig } from "vitest/config";

// Timing-sensitive tests (*.perf.test.ts) are isolated from the parallel unit pass.
// Scripts: `test:unit` excludes them; `test:perf` runs only them, serially, in one fork.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    pool: "forks",
  },
});
