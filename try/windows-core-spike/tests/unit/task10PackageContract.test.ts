import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Task 10 package command contract", () => {
  it("routes Fast, default, and full gates through verify-spike.ps1", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts.check).toBe(
      "pwsh -NoProfile -File ./scripts/verify-spike.ps1 -Fast",
    );
    expect(packageJson.scripts["check:core"]).toBe(
      "pwsh -NoProfile -File ./scripts/verify-spike.ps1",
    );
    expect(packageJson.scripts["check:full"]).toBe(
      "pwsh -NoProfile -File ./scripts/verify-spike.ps1 -IncludeSoak",
    );
  });
});
