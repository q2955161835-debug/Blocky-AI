import type { Options } from "@wdio/types";
import type { TauriCapabilities } from "@wdio/tauri-service";
import "@wdio/tauri-service";
import { resolve } from "node:path";
import { createServer } from "node:net";
const application = resolve("try/native-e2e-target/release/blocky-studio.exe");
// Test-process-only CDP. No registry change, production option or global browser launch.
if (!process.env.BLOCKY_TEST_CDP_PORT) {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("CDP port allocation failed");
  process.env.BLOCKY_TEST_CDP_PORT = String(address.port);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${process.env.BLOCKY_TEST_CDP_PORT} --remote-debugging-address=127.0.0.1`;
export const config: Options.Testrunner & {
  capabilities: TauriCapabilities[];
} = {
  runner: "local",
  specs: [
    resolve(
      process.env.BLOCKY_NATIVE_SUITE
        ? "tests/e2e/core.e2e.ts"
        : "tests/e2e/studio.e2e.ts",
    ),
  ],
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
