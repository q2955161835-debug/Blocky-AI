import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
// The release build uses this same verifier before bundling the official SDK.
// @ts-expect-error The build scripts are untyped ESM.
import { verifyPiCore } from "../../../scripts/check-pi-core.mjs";

it("accepts installed upstream bytes and rejects version or source substitution", async () => {
  const lock=JSON.parse(await readFile("vendor/pi-core-lock.json","utf8"));
  await expect(verifyPiCore()).resolves.toMatchObject({tag:"v0.86.0"});
  const version=structuredClone(lock); version.packages[0].version="0.85.0";
  await expect(verifyPiCore(process.cwd(),version)).rejects.toThrow("version mismatch");
  const bytes=structuredClone(lock); bytes.packages[0].files[1].sha256="0".repeat(64);
  await expect(verifyPiCore(process.cwd(),bytes)).rejects.toThrow("hash mismatch");
});
