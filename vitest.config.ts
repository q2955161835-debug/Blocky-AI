import { defineConfig } from "vitest/config";
import { availableParallelism } from "node:os";
export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "tests/contracts/**/*.test.ts",
      "tests/component/**/*.test.tsx",
      "tests/cli/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**"],
    testTimeout: 10000,
    // Real Node/Host subprocesses share the runner CPUs with Vitest workers.
    maxWorkers: Math.max(1, Math.min(8, Math.floor(availableParallelism() / 2))),
  },
});
