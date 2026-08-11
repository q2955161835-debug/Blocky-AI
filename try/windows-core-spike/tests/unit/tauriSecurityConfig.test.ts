import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tauriConfig = JSON.parse(
  readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
) as Record<string, unknown>;
const mainCapability = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "src-tauri/capabilities/main.json"),
    "utf8",
  ),
) as Record<string, unknown>;

describe("normal Tauri release security configuration", () => {
  it("uses the local-only build, fixed Simplified Chinese window, and constrained CSP", () => {
    expect(tauriConfig).toMatchObject({
      $schema: "https://schema.tauri.app/config/2",
      productName: "Blocky",
      version: "0.0.0",
      identifier: "ai.blocky.windowscorespike",
      build: {
        beforeDevCommand: "pnpm dev",
        devUrl: "http://localhost:1420",
        beforeBuildCommand: "pnpm build",
        frontendDist: "../dist",
      },
      app: {
        withGlobalTauri: false,
        windows: [
          {
            label: "main",
            title: "Blocky",
            width: 1440,
            height: 900,
            minWidth: 1180,
            minHeight: 720,
            decorations: false,
          },
        ],
        security: {
          capabilities: ["main"],
          csp: "default-src 'self'; img-src 'self' asset: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src ipc: http://ipc.localhost",
        },
      },
      bundle: {
        active: true,
        targets: ["nsis"],
      },
    });
  });

  it("grants only the default core and explicit custom-titlebar window controls", () => {
    expect(mainCapability).toMatchObject({
      identifier: "main",
      windows: ["main"],
      permissions: [
        "core:default",
        "core:window:allow-minimize",
        "core:window:allow-toggle-maximize",
        "core:window:allow-close",
        "core:window:allow-start-dragging",
      ],
    });
    expect(mainCapability.permissions).toEqual([
      "core:default",
      "core:window:allow-minimize",
      "core:window:allow-toggle-maximize",
      "core:window:allow-close",
      "core:window:allow-start-dragging",
    ]);
  });
});
