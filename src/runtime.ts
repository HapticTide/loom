/**
 * runtime.ts — Agent 运行时调度层
 *
 * 职责：创建 runtime、检测可用 agent、调度子进程。
 * Agent 特定逻辑（参数、流式解析）委托给 agents/ 模块。
 */

import { spawn, execFileSync } from "node:child_process";
import * as fs from "node:fs";

import { logger } from "./logger.js";
import { getAgent, listAgentNames } from "./agents/index.js";
import type { AgentRunOptions, AgentRunResult, StreamLineParser } from "./agents/types.js";

export type { AgentRunOptions, AgentRunResult } from "./agents/types.js";

const DEFAULT_AGENT_TIMEOUT_MS = Number(process.env.LOOM_AGENT_TIMEOUT_MS) || 30 * 60 * 1000;

export class AgentRuntime {
  readonly name: string;
  private logFile: string | null = null;

  constructor(agentName: string) {
    this.name = agentName.toLowerCase();
    getAgent(this.name); // 验证存在
  }

  setLogFile(filePath: string): void {
    this.logFile = filePath;
  }

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const agent = getAgent(this.name);
    const { cmd, args } = agent.spec;
    const timeoutMs = options.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;

    return spawnAgent(
      cmd, [...args], options.prompt, options.workDir,
      this.logFile, timeoutMs, agent.parseStreamLine, agent.extractFinalResponse,
    );
  }
}

export interface Runtimes {
  generator: AgentRuntime;
  evaluator: AgentRuntime;
}

// --- 子进程调度 ---

function spawnAgent(
  cmd: string,
  args: string[],
  prompt: string,
  cwd: string,
  logFile: string | null,
  timeoutMs: number,
  streamParser: StreamLineParser,
  extractResponse: (stdout: string) => string,
): Promise<AgentRunResult> {
  logger.debug("Runtime", `$ ${cmd} ${args.map(a => a.length > 50 ? a.slice(0, 47) + "..." : a).join(" ")}`);

  const logStream = logFile ? fs.createWriteStream(logFile, { flags: "a", encoding: "utf-8" }) : null;
  logStream?.write(`\n--- ${new Date().toISOString()} ---\n`);

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let lineBuf = "";

    const timer = setTimeout(() => {
      logger.warn("Runtime", `Agent timed out after ${timeoutMs / 1000}s, killing...`);
      proc.kill("SIGTERM");
      setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 5000);
    }, timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      logStream?.write(chunk);

      // 逐行解析 NDJSON 流式事件
      lineBuf += chunk.toString();
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const event = streamParser(trimmed);
        if (event) {
          const prefix = event.kind === "tool_use" ? "🔧" :
            event.kind === "tool_result" ? "📋" :
            event.kind === "text" ? "💬" : "✅";
          logger.info(`Agent:${cmd}`, `${prefix} ${event.summary}`);
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      logStream?.write(chunk);
    });

    proc.stdin.write(prompt);
    proc.stdin.end();

    proc.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString();
      const stderr = Buffer.concat(stderrChunks).toString();
      if (stderr.trim()) logger.debug(`Agent:${cmd}`, stderr.trim().slice(0, 500));

      if (logStream) {
        logStream.write(`\n--- exit ${code ?? 1}, ${((Date.now() - startTime) / 1000).toFixed(1)}s ---\n`);
        logStream.end();
      }

      const exitCode = code ?? 1;
      const response = extractResponse(stdout).trim();

      if (exitCode === 0 && !response) {
        logger.warn(`Agent:${cmd}`, "Agent exited successfully but produced no output");
      }
      resolve({ response, exitCode: (exitCode === 0 && !response) ? 1 : exitCode });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      logStream?.end();
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(`'${cmd}' not found. Ensure it is installed and in PATH.`));
      } else {
        reject(err);
      }
    });
  });
}

// --- Runtime 创建 ---

export function createRuntime(name: string): AgentRuntime {
  return new AgentRuntime(name);
}

export function detectRuntime(): AgentRuntime {
  const envRuntime = process.env.LOOM_RUNTIME;
  if (envRuntime) return createRuntime(envRuntime);

  for (const name of listAgentNames()) {
    const agent = getAgent(name);
    if (!commandExists(agent.spec.cmd)) continue;
    logger.info("Runtime", `Detected: ${name}`);
    return new AgentRuntime(name);
  }

  throw new Error(`No agent runtime found.\nInstall one of: ${listAgentNames().join(", ")}`);
}

function commandExists(cmd: string): boolean {
  if (typeof Bun !== "undefined" && typeof Bun.which === "function") {
    return Bun.which(cmd) !== null;
  }
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
