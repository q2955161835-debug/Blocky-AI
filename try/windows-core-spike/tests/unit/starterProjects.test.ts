import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildEditorProjection } from "../../src/blockly/BlocklyCanvas";
import { countSerializedBlocks } from "../../src/blockly/fixtures";
import { createCourseAssistantStarterWorkspace } from "../../src/blockly/starterProjects";

describe("course assistant starter project", () => {
  it("opens as the same editable multimodal Agent pipeline as the saved POC", () => {
    const workspace = createCourseAssistantStarterWorkspace();
    const projection = buildEditorProjection(workspace);

    expect(countSerializedBlocks(workspace)).toBe(17);
    expect(projection.diagnostics).toEqual([]);
    expect(projection.interactionManifest.entries).toEqual([
      expect.objectContaining({
        id: "poc-course-entry",
        ownerAgentId: "poc-course-agent",
        acceptedParts: ["text", "image", "file", "voice"],
        exposedSkills: ["course-material-analysis"],
        exposedPluginActions: ["create-learning-card"],
      }),
    ]);
  });

  it("keeps the submitted .blocky archive bound to the built-in editable starter", async () => {
    const pocPath = resolve(
      process.cwd(),
      "../../POC与演示视频/Blocky-自然科学课程助教-Agent.blocky",
    );
    const archive = await JSZip.loadAsync(await readFile(pocPath));
    const projectEntry = archive.file("project.json");

    expect(projectEntry).not.toBeNull();
    const project = JSON.parse(await projectEntry!.async("string")) as {
      workspace: unknown;
    };
    expect(project.workspace).toEqual(createCourseAssistantStarterWorkspace());
  });
});
