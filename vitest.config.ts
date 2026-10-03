import { defineConfig } from "vitest/config";
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
    // Leave capacity for tests that start real Node/Host child processes.
    maxWorkers: 8,
  },
});
