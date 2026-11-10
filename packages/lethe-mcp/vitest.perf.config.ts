import { defineConfig } from "vitest/config";

// Serial pass for timing assertions: one fork, no file parallelism.
export default defineConfig({
  test: {
    include: ["test/**/*.perf.test.ts"],
    exclude: ["**/node_modules/**"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    passWithNoTests: true,
  },
});
