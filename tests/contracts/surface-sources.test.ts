import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import sources from "../../packages/app-surface/src/sources.json";
import config from "../../apps/studio-host/tauri.conf.json";
it("binds the fixed preview script to source bytes and the ordinary CSP", () => {
  for (const name of ["page.html", "page.css", "page.js"] as const)
    expect(
      readFileSync(`packages/app-surface/templates/${name}`, "utf8").replace(
        /\r\n/g,
        "\n",
      ),
    ).toBe(sources.files[`src/${name}`]);
  const hash = createHash("sha256")
    .update(sources.files["src/page.js"])
    .digest("base64");
  expect(hash).toBe(sources.scriptHash);
  expect(config.app.security.csp).toContain(`'sha256-${hash}'`);
  expect(config.app.security.csp).not.toContain("script-src 'unsafe-inline'");
});
