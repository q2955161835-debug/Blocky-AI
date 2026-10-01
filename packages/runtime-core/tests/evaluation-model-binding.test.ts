import { expect, it } from "vitest";
import type { Resource } from "@blocky/language-schema";
import { createStarter } from "../../test-fixtures/src";
import { createEvaluationModelBinding } from "../src/evaluation/model-binding";

it("binds a legacy local composer to its declared deterministic adapter", async () => {
  const resource = createStarter().resources["local-composer"];
  const binding = await createEvaluationModelBinding(resource);
  expect(binding).toMatchObject({
    resourceId: "local-composer",
    provider: "deterministic",
    modelId: resource.definition.implementationRef,
  });
  expect(binding.version).toMatch(/^configuration-[a-f0-9]{16}$/);
  const changed = await createEvaluationModelBinding({ ...resource, displayName: "Renamed" });
  expect(changed.version).not.toBe(binding.version);
});

it("preserves explicit provider and model identity", async () => {
  const resource = createStarter().resources["local-composer"];
  resource.definition = { provider: "openai-compatible", modelId: "text-model" };
  expect(await createEvaluationModelBinding(resource)).toMatchObject({
    provider: "openai-compatible",
    modelId: "text-model",
  });
});

it("rejects missing or unsupported identities instead of stringifying undefined", async () => {
  const resource = createStarter().resources["local-composer"];
  const definitions: Resource["definition"][] = [
    {},
    { provider: "openai-compatible" },
    { implementationRef: "adapter://deterministic/unknown-v1" },
  ];
  for (const definition of definitions) {
    await expect(createEvaluationModelBinding({ ...resource, definition })).rejects.toThrow(
      "BLK-EVAL-MODEL-BINDING",
    );
  }
});
