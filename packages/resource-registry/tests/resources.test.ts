import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src/index";
import { resolveResource } from "../src/index";
it("resolves a declared project resource and rejects undeclared definitions", () => {
  const p = createStarter();
  expect(resolveResource(p, "product-handbook", "knowledge").displayName).toBe(
    "自然科学资料",
  );
  p.manifest.resources = [];
  expect(() => resolveResource(p, "product-handbook", "knowledge")).toThrow(
    "BLK-RESOURCE-001",
  );
});
it("does not fall back from user scope to a project definition", () => {
  const p = createStarter();
  p.manifest.resources[0].scope = "user";
  p.manifest.resources[0].definitionRef = "local-handbook";
  expect(() => resolveResource(p, "product-handbook", "knowledge")).toThrow(
    "BLK-RESOURCE-001",
  );
});
