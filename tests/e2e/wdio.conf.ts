import type { Options } from "@wdio/types";
import type { TauriCapabilities } from "@wdio/tauri-service";
import "@wdio/tauri-service";
import { resolve } from "node:path";
const application = resolve("try/native-e2e-target/release/blocky-studio.exe");
export const config: Options.Testrunner & {
  capabilities: TauriCapabilities[];
} = {
  runner: "local",
  specs: [resolve("tests/e2e/studio.e2e.ts")],
  maxInstances: 1,
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath: application,
        driverProvider: "embedded",
        captureBackendLogs: true,
        captureFrontendLogs: true,
        backendLogLevel: "info",
        frontendLogLevel: "warn",
        startTimeout: 120000,
        commandTimeout: 30000,
        logDir: resolve("try/stage1-e2e/logs"),
      },
    ],
  ],
  capabilities: [{ browserName: "tauri", "tauri:options": { application } }],
  outputDir: resolve("try/stage1-e2e/logs"),
  logLevel: "warn",
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 1,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 120000 },
};
