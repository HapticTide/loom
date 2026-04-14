/**
 * agents/index.ts — Agent 注册表
 *
 * 新增 agent：创建文件 → 注册到 AGENTS。
 */

import type { AgentSpec, StreamLineParser } from "./types.js";
import * as claude from "./claude.js";
import * as codex from "./codex.js";
import * as gemini from "./gemini.js";

export type { AgentSpec, AgentRunOptions, AgentRunResult, ProgressEvent, StreamLineParser } from "./types.js";

export interface AgentAdapter {
  spec: AgentSpec;
  parseStreamLine: StreamLineParser;
  extractFinalResponse: (stdout: string) => string;
}

const AGENTS: Record<string, AgentAdapter> = {
  claude: { spec: claude.spec, parseStreamLine: claude.parseStreamLine, extractFinalResponse: claude.extractFinalResponse },
  codex: { spec: codex.spec, parseStreamLine: codex.parseStreamLine, extractFinalResponse: codex.extractFinalResponse },
  gemini: { spec: gemini.spec, parseStreamLine: gemini.parseStreamLine, extractFinalResponse: gemini.extractFinalResponse },
};

export function getAgent(name: string): AgentAdapter {
  const agent = AGENTS[name];
  if (!agent) {
    throw new Error(
      `Unknown runtime preset: "${name}"\nAvailable: ${Object.keys(AGENTS).join(", ")}`,
    );
  }
  return agent;
}

export function listAgentNames(): string[] {
  return Object.keys(AGENTS);
}
