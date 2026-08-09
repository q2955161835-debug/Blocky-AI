import type { Options } from "@wdio/types";
import type { TauriCapabilities } from "@wdio/tauri-service";
import "@wdio/tauri-service";

const appBinaryPath = "./src-tauri/target/release/blocky-windows-core-spike.exe";

type NativeTauriRunnerConfig = Options.Testrunner & {
  capabilities: TauriCapabilities[];
};

export const config: NativeTauriRunnerConfig = {
  runner: "local",
  specs: ["./tests/e2e/**/*.e2e.ts"],
  maxInstances: 1,
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath,
        driverProvider: "embedded",
        captureBackendLogs: true,
        captureFrontendLogs: true,
        startTimeout: Number(process.env.BLOCKY_E2E_START_TIMEOUT ?? 120_000),
        commandTimeout: 30_000,
        logDir: "./artifacts/wdio",
      },
    ],
  ],
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": { application: appBinaryPath },
    },
  ],
  logLevel: "info",
  outputDir: "./artifacts/wdio",
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 120_000 },
};
