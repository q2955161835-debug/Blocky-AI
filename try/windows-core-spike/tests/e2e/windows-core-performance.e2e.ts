import { browser, expect } from "@wdio/globals";
import "@wdio/tauri-service";

interface OperationMetric {
  readonly samplesMs: readonly number[];
  readonly medianMs: number;
  readonly observedBlockCounts: readonly number[];
  readonly observedNodeCounts: readonly number[];
}

interface PerformanceMetrics {
  readonly schemaVersion: "blocky.performance/v0-spike";
  readonly environment: {
    readonly userAgent: string;
    readonly hardwareConcurrency: number;
  };
  readonly load: OperationMetric;
  readonly saveCompile: OperationMetric;
  readonly runtime: OperationMetric;
}

interface PerformanceHookWindow {
  __BLOCKY_SPIKE_TEST__: {
    measureCorePerformance(): Promise<PerformanceMetrics>;
  };
}

function assertMetric(
  metric: OperationMetric,
  thresholdMs: number,
): void {
  expect(metric.samplesMs).toHaveLength(5);
  expect(metric.samplesMs.every(Number.isFinite)).toBe(true);
  expect(Number.isFinite(metric.medianMs)).toBe(true);
  expect(metric.observedBlockCounts).toEqual([100, 100, 100, 100, 100]);
  expect(metric.observedNodeCounts).toEqual([100, 100, 100, 100, 100]);
  expect(metric.medianMs).toBeLessThanOrEqual(thresholdMs);
}

describe("Windows Core native performance gates", () => {
  it("measures five post-warmup WebView samples at the frozen thresholds", async () => {
    const metrics = await browser.tauri.execute(({ core: _core }) =>
      (window as unknown as PerformanceHookWindow)
        .__BLOCKY_SPIKE_TEST__.measureCorePerformance(),
    );

    console.log(`BLOCKY_PERFORMANCE ${JSON.stringify(metrics)}`);
    expect(metrics.schemaVersion).toBe("blocky.performance/v0-spike");
    expect(metrics.environment.userAgent).toContain("Windows");
    assertMetric(metrics.load, 1_500);
    assertMetric(metrics.saveCompile, 750);
    assertMetric(metrics.runtime, 1_500);
  });
});
