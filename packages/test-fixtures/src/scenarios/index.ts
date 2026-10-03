import type { Project } from "@blocky/language-schema";
import { createAgentExample } from "./agent";
import { createArchitectureStarter } from "./architecture";
import {
  createKnowledgeCorrectionScenario,
  createKnowledgeIngestionScenario,
} from "./knowledge";
import { createToolLoopScenario, delegationStarter } from "./agent-tools";

export { createAgentExample, createArchitectureStarter, delegationStarter };
export {
  createKnowledgeCorrectionScenario,
  createKnowledgeIngestionScenario,
  createToolLoopScenario,
};

/** Compatibility factory for test scenarios formerly composed in product templates. */
export function createCapabilityStarter(
  id: string,
  projectId = `project-${crypto.randomUUID()}`,
): Project {
  switch (id) {
    case "knowledge-ingestion":
      return createKnowledgeIngestionScenario(projectId);
    case "knowledge-correction":
      return createKnowledgeCorrectionScenario(projectId);
    case "tool-assistant":
      return createToolLoopScenario(projectId);
    default:
      throw Error("BLK-STARTER-001");
  }
}
