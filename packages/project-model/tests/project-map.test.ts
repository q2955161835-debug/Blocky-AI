import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import { affectedModules, projectMap, renameModule } from "../src";

it("keeps stable cross-canvas links across rename and reports direct impact", () => {
  const project = createStarter();
  const before = projectMap(project);
  const research = before.find((module) => module.moduleId === "research-agent")!;
  expect(research.outgoing.some((link) => link.targetModuleId === "citation-service" && !link.broken)).toBe(true);
  renameModule(project, "citation-service", "新的服务名称");
  const after = projectMap(project);
  expect(after.find((module) => module.moduleId === "citation-service")?.displayName).toBe("新的服务名称");
  expect(after.find((module) => module.moduleId === "research-agent")?.outgoing).toEqual(research.outgoing);
  expect(affectedModules(project, "citation-service")).toContain("research-agent");
});
