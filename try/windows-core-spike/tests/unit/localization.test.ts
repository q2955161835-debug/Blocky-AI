import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";

const indexHtml = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const tauriConfig = JSON.parse(
  readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
) as {
  productName: string;
  app: { windows: Array<{ title: string }> };
};

describe("Windows Core spike localization", () => {
  it("renders only Simplified Chinese page and window labels", async () => {
    expect(indexHtml).toContain('<html lang="zh-CN">');
    expect(indexHtml).toContain("<title>Blocky Windows 核心尖峰</title>");
    expect(indexHtml).not.toContain("Blocky Windows Core Spike");
    expect(tauriConfig.productName).toBe("Blocky Windows 核心尖峰");
    expect(tauriConfig.app.windows[0]?.title).toBe("Blocky Windows 核心尖峰");

    document.body.innerHTML = '<div id="root"></div>';
    await import("../../src/main");

    await waitFor(() => {
      expect(screen.getByRole("main")).toHaveTextContent("Blocky Windows 核心尖峰");
    });
    expect(document.body).not.toHaveTextContent("Blocky Windows Core Spike");
  });
});
