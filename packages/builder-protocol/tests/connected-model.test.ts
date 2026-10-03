import { expect, it } from "vitest";
import { modelResource } from "../../../tests/fixtures/model-resource";
import { parseRegistry, resolveRegistryResources } from "../../resource-registry/src";
import { createAgentExample } from "../../test-fixtures/src/scenarios";
import { applyDefaultModel } from "../../project-model/src";
import { compileProject } from "../../compiler/src";
import { createBuilderSession } from "../src";
it("isolates Builder model snapshots without losing their validated connection bindings",async()=>{
  const registry=resolveRegistryResources(parseRegistry({schemaVersion:"blocky.resource-registry/v1",resources:[modelResource()]}));
  const project=applyDefaultModel(createAgentExample("builder-test"),"saved-model",registry);
  expect((await compileProject(project,registry)).diagnostics.filter(d=>d.severity==="error")).toEqual([]);
  const session=await createBuilderSession(project,{schemaVersion:"blocky.builder-request/v1",requestId:"session-test",projectId:"builder-test",moduleId:project.manifest.modules[0].moduleId,intent:"build",prompt:"Answer briefly",selection:[],createSurface:false},{registry});
  expect(session.inspect().diagnostics.filter(d=>d.severity==="error")).toEqual([]);
  registry.get("saved-model")!.displayName="Mutated outside";
  expect(session.inspect().resources.find(r=>r.resourceId==="saved-model")?.displayName).toBe("Saved online model");
});
