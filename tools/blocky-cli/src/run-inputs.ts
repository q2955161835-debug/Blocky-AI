import { z } from "zod";

/** JSON Schema describes the shape; execution also enforces UTF-8 byte limits. */
export const runInputsSchema = z
  .array(z.string().max(16000).describe("最多 16000 UTF-8 字节。"))
  .min(1)
  .max(32)
  .describe("在同一运行会话中依次处理；文件最多 128 KiB，失败或取消后停止。");
