import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "tests/contracts/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    testTimeout: 10000,
  },
});
