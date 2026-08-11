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

describe("Blocky product localization", () => {
  it("uses product-facing Blocky metadata and keeps internal spike copy out of the rendered UI", async () => {
    expect(indexHtml).toContain('<html lang="zh-CN">');
    expect(indexHtml).toContain("<title>Blocky</title>");
    expect(tauriConfig.productName).toBe("Blocky");
    expect(tauriConfig.app.windows[0]?.title).toBe("Blocky");

    document.body.innerHTML = '<div id="root"></div>';
    await import("../../src/main");

    await waitFor(() => {
      expect(screen.getByRole("banner", { name: "应用标题栏" }))
        .toHaveTextContent("Blocky");
    });
    expect(document.body).not.toHaveTextContent(/Windows Core|核心尖峰|技术尖峰/);
  }, 15_000);
});
