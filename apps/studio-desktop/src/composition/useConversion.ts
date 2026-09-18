import { useEffect, useRef, useState } from "react";
import {
  ConversionScanner,
  realConversionCandidate,
  type ConversionReport,
  type SourceArtifact,
} from "@blocky/conversion-core";
import { knowledgeNative } from "./knowledge";
import type { Studio } from "./useStudio";
export function useConversion(
  studio: Studio,
  review: (
    candidate: Awaited<ReturnType<typeof realConversionCandidate>>,
  ) => Promise<void>,
) {
  const [report, setReport] = useState<ConversionReport>();
  const [artifact, setArtifact] = useState<SourceArtifact>();
  const [reference, setReference] = useState("HEAD"),
    [subdir, setSubdir] = useState("");
  const [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const [source, setSource] = useState<{ path: string; content: string }>();
  const abort = useRef<AbortController | undefined>(undefined);
  const projectId = studio.snapshot.project.manifest.projectId;
  useEffect(() => {
    setReport(undefined);
    setArtifact(undefined);
    setSource(undefined);
    setStatus("");
    return () => {
      abort.current?.abort();
      void new ConversionScanner(knowledgeNative, projectId)
        .cancel()
        .catch(() => {});
    };
  }, [projectId]);
  const scanner = () => new ConversionScanner(knowledgeNative, projectId);
  const perform = async (
    work: (client: ConversionScanner, signal: AbortSignal) => Promise<void>,
  ) => {
    if (abort.current || studio.running || studio.busy) return false;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    try {
      await work(scanner(), controller.signal);
      return true;
    } catch (error) {
      setStatus(
        controller.signal.aborted
          ? "已取消。可继续分析已保存的快照。"
          : `无法继续转换：${error instanceof Error ? error.message : "来源不可用"}`,
      );
      return false;
    } finally {
      abort.current = undefined;
      setBusy(false);
    }
  };
  const analyze = async (
    client: ConversionScanner,
    value: SourceArtifact,
    signal: AbortSignal,
  ) => {
    const next = await client.analyze(value, signal, (n, total) =>
      setStatus(`正在分析 ${n} / ${total} 个文件`),
    );
    signal.throwIfAborted();
    setReport(next);
    setStatus(
      `完成：分析 ${next.stats.analyzed} 个，复用 ${next.stats.reused} 个。项目未修改。`,
    );
  };
  return {
    report,
    artifact,
    reference,
    setReference,
    subdir,
    setSubdir,
    status,
    busy,
    source,
    cancel: () => {
      abort.current?.abort();
      void scanner()
        .cancel()
        .catch(() => {});
    },
    scan: () =>
      perform(async (client, signal) => {
        setReport(undefined);
        setSource(undefined);
        setStatus("选择仓库并读取锁定版本…");
        const value = await client.scan(
          {
            ref: reference,
            ...(subdir.trim() ? { subdir: subdir.trim() } : {}),
          },
          signal,
        );
        setArtifact(value);
        await analyze(client, value, signal);
      }),
    resume: () =>
      perform(async (client, signal) => {
        if (artifact) await analyze(client, artifact, signal);
      }),
    openSource: (path: string) =>
      perform(async (client, signal) => {
        if (!artifact) return;
        const file = await client.source(artifact, path, signal);
        setSource({ path, content: file.content });
      }),
    candidate: (selection: {
      file: string;
      symbol: string;
      lineStart: number;
    }) =>
      perform(async (client, signal) => {
        if (!report) return;
        const project = studio.controller.getSnapshot().project;
        const candidate = await realConversionCandidate(
          project,
          studio.session.active,
          report,
          selection,
          client,
          signal,
          studio.resources.map,
        );
        signal.throwIfAborted();
        await review(candidate);
      }),
  };
}
