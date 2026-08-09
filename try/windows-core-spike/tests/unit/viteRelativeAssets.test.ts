import { describe, expect, it } from "vitest";
import { build } from "vite";

type BuildOutput = {
  output: Array<{
    type: "asset" | "chunk";
    fileName: string;
    source?: string | Uint8Array;
  }>;
};

describe("Vite production asset paths", () => {
  it("emits explicit relative script and stylesheet URLs in a fresh in-memory build", async () => {
    const result = await build({
      root: process.cwd(),
      mode: "production",
      logLevel: "silent",
      build: { write: false },
    });
    if (!result || "on" in result) throw new Error("Expected completed Vite build output");
    const outputs = (Array.isArray(result) ? result : [result]) as BuildOutput[];
    const html = outputs
      .flatMap((output) => output.output)
      .find((item) => item.type === "asset" && item.fileName === "index.html");
    if (!html?.source) throw new Error("Expected built index.html");
    const markup =
      typeof html.source === "string"
        ? html.source
        : new TextDecoder().decode(html.source);
    const document = new DOMParser().parseFromString(markup, "text/html");
    const scripts = [...document.querySelectorAll("script[src]")].map((element) =>
      element.getAttribute("src"),
    );
    const styles = [
      ...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'),
    ].map((element) => element.getAttribute("href"));

    expect(scripts.length).toBeGreaterThan(0);
    expect(styles.length).toBeGreaterThan(0);
    expect(scripts.every((url) => url?.startsWith("./assets/"))).toBe(true);
    expect(styles.every((url) => url?.startsWith("./assets/"))).toBe(true);
  });
});
