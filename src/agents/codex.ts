/**
 * agents/codex.ts — Codex CLI adapter
 *
 * 流式模式：--json
 * 事件类型：item.completed（消息/工具）、turn.completed（轮次结束）
 */

import type { AgentSpec, StreamLineParser } from "./types.js";

export const spec: AgentSpec = {
  name: "codex",
  cmd: "codex",
  args: ["exec", "--dangerously-bypass-approvals-and-sandbox", "--ephemeral", "--json", "-"],
};

export const parseStreamLine: StreamLineParser = (line) => {
  let event: Record<string, unknown>;
  try { event = JSON.parse(line); } catch { return null; }

  const type = event.type as string;

  if (type === "item.completed") {
    const item = event.item as Record<string, unknown> | undefined;
    if (!item) return null;
    const itemType = item.type as string;
    if (itemType === "agent_message") return { kind: "text", summary: ((item.text as string) ?? "").slice(0, 120) };
    if (itemType === "tool_call") return { kind: "tool_use", summary: (item.name as string) ?? "tool" };
    if (itemType === "tool_result") return { kind: "tool_result", summary: (item.name as string) ?? "done" };
    return null;
  }

  if (type === "turn.completed") {
    const output = (event.usage as Record<string, unknown>)?.output_tokens as number | undefined;
    return { kind: "turn_complete", summary: `${output ?? "?"} output tokens` };
  }

  return null;
};

/** 从 JSONL 输出收集所有 agent_message 文本 */
export function extractFinalResponse(stdout: string): string {
  const messages: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event.type === "item.completed") {
        const item = event.item as Record<string, unknown> | undefined;
        if (item?.type === "agent_message" && typeof item.text === "string") messages.push(item.text);
      }
    } catch { continue; }
  }
  return messages.length > 0 ? messages.join("\n") : stdout;
}
