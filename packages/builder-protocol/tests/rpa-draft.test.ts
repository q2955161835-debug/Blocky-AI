import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import { planToRpaBlocks } from "@blocky/rpa-core";
import { ProjectController, projectDigest } from "@blocky/project-model";
import { makePatch, previewPatch, applyPatch } from "../src";
it("requires the RPA permission delta and applies the reviewed ghost blocks as one undo transaction",async()=>{
  const project=createStarter(),controller=new ProjectController(project),before=await projectDigest(project);
  const root=planToRpaBlocks({schemaVersion:"blocky.rpa/v1",planId:"owned",target:{kind:"browser",identity:"https://example.test"},steps:[{stepId:"fill",action:"fill",timeoutMs:1000,locator:{kind:"browser",role:"textbox",name:"Answer"},effectKey:"fill-once",value:{kind:"manual-input"}}]},"https://example.test/form");
  const patch=await makePatch(project,[{op:"block.add",moduleId:"research-agent",blockId:root.id,payload:root}]);
  expect(patch.permissionDelta).toEqual(["rpa.browser","rpa.input","rpa.read","rpa.write"]);
  await previewPatch(project,patch);expect(await projectDigest(controller.getSnapshot().project)).toBe(before);
  await expect(applyPatch(controller,patch,[])).rejects.toThrow("BLK-PATCH-003");
  await applyPatch(controller,patch,patch.permissionDelta);expect(controller.getSnapshot().canUndo).toBe(true);
  controller.undo();expect(await projectDigest(controller.getSnapshot().project)).toBe(before);
});
