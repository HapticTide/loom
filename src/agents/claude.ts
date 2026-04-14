/**
 * agents/claude.ts — Claude Code CLI adapter
 *
 * 流式模式：--output-format stream-json --verbose
 * 事件类型：assistant（工具调用）、user（工具结果）、result（完成）
 */

import type { AgentSpec, StreamLineParser } from "./types.js";

export const spec: AgentSpec = {
  name: "claude",
  cmd: "claude",
  args: ["-p", "--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose"],
};

export const parseStreamLine: StreamLineParser = (line) => {
  let event: Record<string, unknown>;
  try { event = JSON.parse(line); } catch { return null; }

  const type = event.type as string;

  if (type === "assistant") {
    const content = (event.message as Record<string, unknown>)?.content as Array<Record<string, unknown>> | undefined;
    if (!content?.length) return null;
    const tools = content.filter((c) => c.type === "tool_use");
    if (tools.length > 0) return { kind: "tool_use", summary: tools.map((t) => t.name as string).join(", ") };
    const text = content.find((c) => c.type === "text");
    if (text) return { kind: "text", summary: (text.text as string).slice(0, 120) };
    return null;
  }

  if (type === "user") {
    const content = (event.message as Record<string, unknown>)?.content as Array<Record<string, unknown>> | undefined;
    const toolResult = content?.find((c) => c.type === "tool_result");
    if (!toolResult) return null;
    const file = (event.tool_use_result as Record<string, unknown>)?.file as Record<string, unknown> | undefined;
    return { kind: "tool_result", summary: (file?.filePath as string) ?? (toolResult.tool_use_id as string).slice(-8) };
  }

  if (type === "result") {
    const turns = event.num_turns as number | undefined;
    const ms = event.duration_ms as number | undefined;
    return { kind: "turn_complete", summary: `${turns ?? "?"} turns, ${ms ? (ms / 1000).toFixed(1) + "s" : "?"}` };
  }

  return null;
};

/** 从 stream-json NDJSON 的 result 事件中提取最终文本响应 */
export function extractFinalResponse(stdout: string): string {
  const lines = stdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "result" && typeof event.result === "string") return event.result;
    } catch { continue; }
  }
  return stdout;
}
