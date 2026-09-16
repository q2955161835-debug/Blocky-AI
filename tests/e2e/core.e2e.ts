/// <reference types="mocha" />
import { browser, expect } from "@wdio/globals";
import { chromium, type Browser, type Page } from "playwright-core";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
type Api = {
  performance(): Promise<any>;
  startSoak(): Promise<any>;
  cycle(n: number): Promise<any>;
  hiddenRunProbe(): Promise<{ status: string; hostAllowsNewRun: boolean }>;
  windowAllowsRun(): Promise<boolean>;
};
type InputObservation = { type: string; timeMs: number; targetTag: string };
type TestWindow = Window & {
  __BLOCKY_ACCEPTANCE__: Api;
  __BLOCKY_SOAK_INPUT__?: {
    observations: InputObservation[];
    stop(): void;
  };
};
declare global {
  interface Window {
    __BLOCKY_ACCEPTANCE__: Api;
  }
}
describe("formal native Core gates", function () {
  this.timeout(35 * 60 * 1000);
  let cdp: Browser, page: Page;
  const runId = randomUUID();
  before(async () => {
    await mkdir("try/stage2-core", { recursive: true });
    for (const name of [
      "performance",
      "window-policy",
      ...(process.env.BLOCKY_NATIVE_SUITE === "full" ? ["full"] : []),
    ])
      await writeFile(
        `try/stage2-core/${name}.json`,
        JSON.stringify({
          runId,
          passed: false,
          state: "preparing",
          startedAt: new Date().toISOString(),
        }),
      );
    cdp = await chromium.connectOverCDP(
      `http://127.0.0.1:${process.env.BLOCKY_TEST_CDP_PORT}`,
    );
    page = cdp
      .contexts()[0]
      .pages()
      .find(
        (p) =>
          new URL(p.url()).origin === "http://tauri.localhost" ||
          p.url() === "tauri://localhost/",
      )!;
    if (!page) throw Error("test WebView missing");
    await page.waitForFunction(
      () => !!(window as TestWindow).__BLOCKY_ACCEPTANCE__,
    );
    await mkdir("try/stage2-core", { recursive: true });
  });
  after(async () => {
    await cdp?.close();
  });
  it("measures 100 blocks and 100 executed nodes with five post-warmup samples", async () => {
    const metrics = await page.evaluate(() =>
      (window as TestWindow).__BLOCKY_ACCEPTANCE__.performance(),
    );
    await writeFile(
      "try/stage2-core/performance.json",
      JSON.stringify({ runId, ...metrics }, null, 2),
    );
    console.log("BLOCKY_PERFORMANCE", JSON.stringify(metrics));
    for (const [key, limit] of [
      ["load", 1500],
      ["saveCompile", 750],
      ["runtime", 1500],
    ] as const) {
      const m = metrics[key];
      expect(m.samplesMs).toHaveLength(5);
      expect(
        m.samplesMs.every((v: number) => Number.isFinite(v) && v >= 0),
      ).toBe(true);
      expect(m.observedBlockCounts).toEqual([100, 100, 100, 100, 100]);
      expect(m.observedNodeCounts).toEqual([100, 100, 100, 100, 100]);
      expect(m.medianMs).toBeLessThanOrEqual(limit);
    }
  });
  it("preflights actual editor undo, runtime and a Rust archive round trip", async () => {
    await page.evaluate(() =>
      (window as TestWindow).__BLOCKY_ACCEPTANCE__.startSoak(),
    );
    const result = await page.evaluate(() =>
      (window as TestWindow).__BLOCKY_ACCEPTANCE__.cycle(12),
    );
    expect(result).toMatchObject({ blocks: 100, nodes: 100, roundTrip: true });
  });
  it("rejects new runs while hidden and restores authorization through the existing instance", async () => {
    let hidden: { status: string; hostAllowsNewRun: boolean } | undefined;
    try {
      hidden = await page.evaluate(() =>
        (window as TestWindow).__BLOCKY_ACCEPTANCE__.hiddenRunProbe(),
      );
    } finally {
      // The shipped single-instance handler restores this same test window.
      await promisify(execFile)(
        resolve("try/native-e2e-target/release/blocky-studio.exe"),
        [],
        { windowsHide: true, timeout: 15000 },
      );
    }
    await page.waitForFunction(() =>
      (window as TestWindow).__BLOCKY_ACCEPTANCE__.windowAllowsRun(),
    );
    const restored = await page.evaluate(() =>
      (window as TestWindow).__BLOCKY_ACCEPTANCE__.cycle(12),
    );
    const evidence = { runId, hidden, restored, passed: false };
    await writeFile(
      "try/stage2-core/window-policy.json",
      JSON.stringify(evidence, null, 2),
    );
    expect(hidden).toEqual({ status: "not-started", hostAllowsNewRun: false });
    expect(restored.blocks).toBe(100);
    expect(restored.nodes).toBe(100);
    expect(restored.roundTrip).toBe(true);
    evidence.passed = true;
    await writeFile(
      "try/stage2-core/window-policy.json",
      JSON.stringify(evidence, null, 2),
    );
  });
  if (process.env.BLOCKY_NATIVE_SUITE === "full")
    it("completes all 360 five-second cycles and 30 native archive round trips", async () => {
      const errors: string[] = [],
        outbound: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        if (
          /^https?:/.test(r.url()) &&
          !["http://tauri.localhost", "http://ipc.localhost"].includes(
            new URL(r.url()).origin,
          )
        )
          outbound.push(new URL(r.url()).origin);
      });
      const preparation = await page.evaluate(() =>
        (window as TestWindow).__BLOCKY_ACCEPTANCE__.startSoak(),
      );
      expect(preparation.blocks).toBe(100);
      expect(preparation.nodes).toBe(100);
      const session = await page.context().newCDPSession(page);
      // Observe contamination without preventing or changing any user input.
      // Never retain keys, text, values, coordinates, or accessible names.
      await page.evaluate(() => {
        const observations: InputObservation[] = [];
        const types = ["pointerdown", "keydown", "wheel"];
        const observe = (event: Event) => {
          if (event.isTrusted && observations.length < 30)
            observations.push({
              type: event.type,
              timeMs: performance.now(),
              targetTag:
                event.target instanceof Element ? event.target.tagName : "",
            });
        };
        for (const type of types) window.addEventListener(type, observe, true);
        (window as TestWindow).__BLOCKY_SOAK_INPUT__ = {
          observations,
          stop() {
            for (const type of types)
              window.removeEventListener(type, observe, true);
          },
        };
      });
      const started = Date.now();
      let warmHeap = 0,
        finalHeap = 0,
        roundTrips = 0;
      const binary = await readFile(
        "try/native-e2e-target/release/blocky-studio.exe",
      );
      const report: any = {
        runId,
        passed: false,
        schemaVersion: "blocky.soak/v1",
        startedAt: new Date(started).toISOString(),
        cycles: 0,
        roundTrips: 0,
        binary: {
          bytes: binary.length,
          sha256: createHash("sha256").update(binary).digest("hex"),
        },
        preparation,
      };
      await writeFile("try/stage2-core/cycles.jsonl", "");
      try {
        for (let cycle = 1; cycle <= 360; cycle++) {
          const start = Date.now();
          const result = await page.evaluate(
            (n) => (window as TestWindow).__BLOCKY_ACCEPTANCE__.cycle(n),
            cycle,
          );
          const input = await page.evaluate(
            () => (window as TestWindow).__BLOCKY_SOAK_INPUT__!.observations,
          );
          expect(input).toEqual([]);
          expect(result.blocks).toBe(100);
          expect(result.nodes).toBe(100);
          expect(result.viewEvents).toBeLessThanOrEqual(500);
          expect(result.logRecords).toBeLessThanOrEqual(500);
          if (result.roundTrip) roundTrips++;
          const remaining = 5000 - (Date.now() - start);
          if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
          if (cycle === 60 || cycle === 360) {
            const heap = await session.send("Runtime.getHeapUsage");
            if (cycle === 60) warmHeap = heap.usedSize;
            else finalHeap = heap.usedSize;
          }
          await appendFile(
            "try/stage2-core/cycles.jsonl",
            JSON.stringify({ ...result, elapsedMs: Date.now() - started }) +
              "\n",
          );
          report.cycles = cycle;
          report.roundTrips = roundTrips;
          expect(errors).toEqual([]);
          expect(outbound).toEqual([]);
          if (cycle % 60 === 0)
            console.log(
              "BLOCKY_SOAK_PROGRESS",
              JSON.stringify({
                cycle,
                roundTrips,
                elapsedMs: Date.now() - started,
              }),
            );
        }
        expect(roundTrips).toBe(30);
        expect(Date.now() - started).toBeGreaterThanOrEqual(1800000);
        expect(warmHeap).toBeGreaterThan(0);
        expect(finalHeap).toBeGreaterThan(0);
        expect(finalHeap - warmHeap).toBeLessThanOrEqual(32 * 1024 * 1024);
        report.passed = true;
      } catch (error) {
        report.failure = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        const trustedInput = await page
          .evaluate(() => {
            const monitor = (window as TestWindow).__BLOCKY_SOAK_INPUT__;
            if (!monitor) return null;
            monitor.stop();
            delete (window as TestWindow).__BLOCKY_SOAK_INPUT__;
            return monitor.observations;
          })
          .catch(() => null);
        const lateInputFailure =
          report.passed && (trustedInput === null || trustedInput.length > 0);
        if (lateInputFailure) {
          report.passed = false;
          report.failure =
            "Full input monitor unavailable or trusted input observed before completion";
        }
        Object.assign(report, {
          elapsedMs: Date.now() - started,
          warmHeap,
          finalHeap,
          heapDelta: finalHeap && warmHeap ? finalHeap - warmHeap : null,
          trustedInput,
          errors,
          outbound,
          endedAt: new Date().toISOString(),
        });
        await writeFile(
          "try/stage2-core/full.json",
          JSON.stringify(report, null, 2),
        );
        await session.detach();
        if (lateInputFailure) throw Error(report.failure);
      }
    });
});
