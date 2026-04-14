/**
 * agents/types.ts — Agent 运行时共享类型
 */

/** Agent 配置 — 描述如何调用一个无头 coding agent */
export interface AgentSpec {
  name: string;
  cmd: string;
  /** 完整命令行参数（含流式输出参数，不含 prompt） */
  args: string[];
}

export interface AgentRunOptions {
  prompt: string;
  workDir: string;
  timeoutMs?: number;
}

export interface AgentRunResult {
  response: string;
  exitCode: number;
}

/** 标准化进度事件 — 从各 agent 的流式输出解析而来 */
export interface ProgressEvent {
  kind: "tool_use" | "tool_result" | "text" | "turn_complete";
  summary: string;
}

/** 流式行解析器 — 每个 agent 实现自己的解析逻辑 */
export type StreamLineParser = (line: string) => ProgressEvent | null;
