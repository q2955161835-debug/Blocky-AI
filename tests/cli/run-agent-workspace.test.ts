import { afterEach, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { compileProject } from "../../packages/compiler/src";
import { createEmptyProject } from "../../packages/project-model/src";
import { parse } from "../../tools/blocky-cli/src/arguments";
import { runAgent } from "../../tools/blocky-cli/src/run-agent";
import { workspaceTransport } from "../../tools/blocky-cli/src/native-store";

afterEach(() => vi.restoreAllMocks());

it("binds and reports the selected workspace during a CLI runtime session", async () => {
  const project = createEmptyProject("Workspace run test");
  project.workspaces.main.blocks.blocks = [
    {
      type: "core.agent",
      id: "test-agent",
      fields: { ROLE: "只返回用户输入" },
      inputs: {
        BODY: {
          block: {
            type: "core.interaction.chat",
            id: "test-chat",
            fields: { NAME: "测试对话" },
            next: {
              block: {
                type: "core.output.answer",
                id: "test-answer",
                fields: { STYLE: "段落" },
              },
            },
          },
        },
      },
    },
  ];
  const compiled = await compileProject(project);
  expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);

  const directory = resolve("try/selected-workspace");
  const bind = vi.spyOn(workspaceTransport, "bind").mockResolvedValue(undefined);
  const status = vi.spyOn(workspaceTransport, "status").mockResolvedValue({
    available: true,
    sessionId: 123,
  });
  const result = await runAgent(
    parse([
      "run", "start", "in-memory.blocky", "--simulate", "--input", "hello",
      "--jsonl", "--workspace-dir", directory,
    ]),
    project,
    compiled.interaction.entries,
    undefined,
    () => {},
    new AbortController().signal,
  );

  expect(result.code).toBe(0);
  expect(bind).toHaveBeenCalledWith(project.manifest.projectId, directory, expect.any(AbortSignal));
  expect(status).toHaveBeenCalledWith(project.manifest.projectId);
  expect(result.result.data).toMatchObject({ workspace: { available: true, sessionId: 123 } });
});
