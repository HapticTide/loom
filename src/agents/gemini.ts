/**
 * agents/gemini.ts — Gemini CLI adapter
 *
 * 流式模式：-o stream-json
 * 事件类型：tool_use、tool_result、message（delta）、result
 */

import type { AgentSpec, StreamLineParser } from "./types.js";

export const spec: AgentSpec = {
  name: "gemini",
  cmd: "gemini",
  args: ["--yolo", "-p", "", "-o", "stream-json"],
};

export const parseStreamLine: StreamLineParser = (line) => {
  let event: Record<string, unknown>;
  try { event = JSON.parse(line); } catch { return null; }

  const type = event.type as string;

  if (type === "tool_use") return { kind: "tool_use", summary: (event.tool_name as string) ?? "tool" };

  if (type === "tool_result") {
    const toolId = (event.tool_id as string) ?? "";
    return { kind: "tool_result", summary: `${toolId.replace(/_\d+_\d+$/, "")}: ${(event.status as string) ?? "done"}` };
  }

  if (type === "message" && event.role === "assistant" && event.delta) {
    const text = (event.content as string) ?? "";
    return text.length > 0 ? { kind: "text", summary: text.slice(0, 120) } : null;
  }

  if (type === "result") {
    const stats = event.stats as Record<string, unknown> | undefined;
    const ms = stats?.duration_ms as number | undefined;
    const tools = stats?.tool_calls as number | undefined;
    return { kind: "turn_complete", summary: `${tools ?? 0} tool calls, ${ms ? (ms / 1000).toFixed(1) + "s" : "?"}` };
  }

  return null;
};

/** 从 stream-json 输出收集所有 assistant delta 拼接 */
export function extractFinalResponse(stdout: string): string {
  const messages: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event.type === "message" && event.role === "assistant" && event.delta && typeof event.content === "string") {
        messages.push(event.content);
      }
    } catch { continue; }
  }
  return messages.length > 0 ? messages.join("") : stdout;
}
