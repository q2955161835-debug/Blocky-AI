import { describe, expect, it } from "vitest";
import { SPIKE_SCOPE } from "../../src/core/spikeScope";

describe("SPIKE_SCOPE", () => {
  it("keeps product features outside the disposable core spike", () => {
    expect(SPIKE_SCOPE.included).toEqual([
      "blockly-editor",
      "stable-ir",
      "interaction-manifest",
      "tool-contract",
      "deterministic-runtime",
      "tauri-project-host",
      "windows-native-e2e",
    ]);
    expect(SPIKE_SCOPE.excluded).toContain("billing");
    expect(SPIKE_SCOPE.excluded).toContain("real-models");
    expect(SPIKE_SCOPE.excluded).toContain("builder-agent");
  });
});
