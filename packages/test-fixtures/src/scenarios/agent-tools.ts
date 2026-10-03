import type { Project, Resource, WorkspaceBlock } from "@blocky/language-schema";
import { createAgentExample } from "./agent";

export function createToolLoopScenario(projectId: string): Project {
  const project = createAgentExample(projectId);
  project.manifest.displayName = "tool-loop test scenario";
  project.manifest.format.minimumReaderVersion = "0.8.0";
  const answer: WorkspaceBlock = {
    type: "core.output.answer",
    id: "answer",
    fields: { STYLE: "段落" },
  };
  const loop: WorkspaceBlock = {
    type: "core.reason.tool_loop",
    id: "tool-loop",
    fields: { RESOURCE: "agent-model", MAX_TURNS: "4", OUTPUT_TOKENS: "512" },
    inputs: {
      TOOLS: {
        block: {
          type: "core.tool.expose",
          id: "text-statistics",
          fields: { RESOURCE: "text-tool" },
        },
      },
    },
    next: { block: answer },
  };
  const budget: WorkspaceBlock = {
    type: "core.run.budget",
    id: "run-budget",
    fields: {
      STEPS: "100",
      CALLS: "8",
      OUTPUT_TOKENS: "2048",
      TIMEOUT_MS: "120000",
    },
    next: { block: loop },
  };
  const root = project.workspaces["research-agent"].blocks.blocks[0];
  root.fields = {
    ROLE: "Use declared tools and their receipts to complete the test task.",
  };
  root.inputs!.BODY.block!.fields = { NAME: "Tool-loop test input" };
  root.inputs!.BODY.block!.next = { block: budget };
  return project;
}

export function delegationStarter(projectId: string): Project {
  const project = createAgentExample(projectId);
  project.manifest.displayName = "delegation test scenario";
  project.manifest.format.minimumReaderVersion = "0.8.0";
  project.resources["agent-model"].definition.parameters = {
    maxOutputTokens: 256,
  };
  project.schemas["schemas/agent-answer.json"] = {
    type: "string",
    maxLength: 16000,
  };
  const resource: Resource = {
    schemaVersion: "blocky.resource/v1alpha1",
    resourceId: "collaborator",
    displayName: "Collaborator fixture",
    kind: "tool",
    scope: "project",
    secretBindings: [],
    capabilityRequirements: ["module.execute"],
    definition: {
      version: "1",
      permissions: ["module.execute"],
      implementationRef: { kind: "adapter", id: "module-tool-v1" },
      moduleId: "collaborator",
      exportId: "answer",
      inputSchemaRef: { kind: "schema", id: "text-input" },
      outputSchemaRef: { kind: "schema", id: "agent-answer" },
      inputSchemaJson: JSON.stringify(project.schemas["schemas/text-input.json"]),
      outputSchemaJson: JSON.stringify(
        project.schemas["schemas/agent-answer.json"],
      ),
      timeoutMs: 120000,
    },
  };
  project.resources.collaborator = resource;
  project.manifest.resources.push({
    resourceId: "collaborator",
    kind: "tool",
    scope: "project",
    definitionRef: "resources/collaborator.json",
    secretRefs: [],
  });
  project.manifest.modules.push({
    moduleId: "collaborator",
    displayName: "Collaborator module fixture",
    purpose: "agent",
    workspaceRef: "workspaces/collaborator.workspace.json",
    exports: [
      {
        exportId: "answer",
        displayName: "Answer",
        kind: "tool",
        inputSchemaRef: "schemas/text-input.json",
        outputSchemaRef: "schemas/agent-answer.json",
      },
    ],
  });
  project.workspaces.collaborator = {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: "core.tool.entry",
          id: "collaborator-entry",
          fields: { EXPORT: "answer" },
          inputs: {
            BODY: {
              block: {
                type: "core.model.compose",
                id: "collaborator-model",
                fields: { RESOURCE: "agent-model" },
                next: {
                  block: {
                    type: "core.output.structured",
                    id: "collaborator-answer",
                    fields: { SCHEMA: "schemas/agent-answer.json" },
                  },
                },
              },
            },
          },
        },
      ],
    },
  };
  const root = project.workspaces["research-agent"].blocks.blocks[0];
  const delegate: WorkspaceBlock = {
    type: "core.agent.delegate",
    id: "delegate",
    fields: {
      TASKS: JSON.stringify([
        {
          agentId: "draft",
          resourceId: "collaborator",
          permissions: ["module.execute"],
          instruction: "Draft a concise response to the user request.",
        },
        {
          agentId: "review",
          resourceId: "collaborator",
          permissions: ["module.execute"],
          instruction: "Review the draft and suggest a concrete improvement.",
        },
      ]),
      MODE: "sequential",
      FAILURE: "stop",
      SOURCE: "input",
    },
    next: {
      block: {
        type: "core.output.answer",
        id: "summary",
        fields: { STYLE: "段落" },
      },
    },
  };
  root.inputs!.BODY.block!.next = {
    block: {
      type: "core.run.budget",
      id: "collaboration-budget",
      fields: {
        STEPS: "100",
        CALLS: "8",
        OUTPUT_TOKENS: "1024",
        TIMEOUT_MS: "120000",
      },
      next: { block: delegate },
    },
  };
  return project;
}

