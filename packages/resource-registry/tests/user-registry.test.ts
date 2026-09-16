import { it, expect } from "vitest";
import {
  emptyRegistry,
  upsertUserResource,
  referenceUserResource,
  resolveResource,
  parseRegistry,
} from "../src/index";
import { createStarter } from "../../test-fixtures/src/index";
it("keeps user definitions outside portable project facts and never falls back across scopes", () => {
  const project = createStarter();
  const source = structuredClone(
    Object.values(project.resources).find((r) => r.kind === "model")!,
  );
  source.scope = "user";
  source.resourceId = "user-model";
  const registry = upsertUserResource(emptyRegistry(), source);
  const linked = referenceUserResource(project, source);
  expect(linked.resources["user-model"]).toBeUndefined();
  expect(() => resolveResource(linked, "user-model", "model")).toThrow();
  expect(
    resolveResource(
      linked,
      "user-model",
      "model",
      new Map(registry.resources.map((r) => [r.resourceId, r])),
    ),
  ).toEqual(source);
  const clash = { ...source, resourceId: Object.keys(project.resources)[0] };
  expect(() => referenceUserResource(project, clash)).toThrow();
  expect(() =>
    parseRegistry({ ...registry, resources: [source, source] }),
  ).toThrow();
});
