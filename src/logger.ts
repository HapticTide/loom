/**
 * logger.ts — 统一日志与 UI 输出
 *
 * 提供分级日志（debug/info/warn/error）+ 彩色终端输出 + 文件持久化。
 * 所有 UI 输出（banner、sprint、attempt、criterion）同步写入 loom.log。
 */

import pc from "picocolors";
import * as fs from "node:fs";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: pc.gray("DEBUG"),
  info: pc.blue("INFO"),
  warn: pc.yellow("WARN"),
  error: pc.red("ERROR"),
};

const LEVEL_PLAIN: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

// ANSI 转义码正则 — 匹配 CSI 序列和 OSC 序列
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07]*\x07)/g;

export class Logger {
  private level: LogLevel;
  private logFile: string | null = null;
  private logStream: fs.WriteStream | null = null;

  constructor(level: LogLevel = "info") {
    this.level = level;
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }

  /** 设置系统日志文件（loom.log）— 所有 log/UI 输出同步写入 */
  setLogFile(filePath: string | null) {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
    this.logFile = filePath;
    if (filePath) {
      this.logStream = fs.createWriteStream(filePath, { flags: "a", encoding: "utf-8" });
    }
  }

  /** 关闭日志流（优雅关闭时调用） */
  close() {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  /** 异步追加到日志文件（去除 ANSI） */
  private writeToFile(text: string) {
    this.logStream?.write(text.replace(ANSI_RE, "") + "\n");
  }

  /** 同时写 console + file */
  private print(formatted: string) {
    console.log(formatted);
    this.writeToFile(formatted);
  }

  log(level: LogLevel, tag: string, message: string) {
    const timestamp = new Date().toISOString().slice(11, 23);
    const formatted = `${pc.dim(timestamp)} ${LEVEL_LABEL[level]} ${pc.cyan(`[${tag}]`)} ${message}`;
    if (this.shouldLog(level)) {
      console.log(formatted);
    }
    // 无论是否输出到 console，都写入文件（文件保留完整记录）
    this.logStream?.write(`${timestamp} ${LEVEL_PLAIN[level]} [${tag}] ${message}\n`);
  }

  debug(tag: string, message: string) { this.log("debug", tag, message); }
  info(tag: string, message: string) { this.log("info", tag, message); }
  warn(tag: string, message: string) { this.log("warn", tag, message); }
  error(tag: string, message: string) { this.log("error", tag, message); }

  // --- UI 输出（同步持久化到 loom.log）---

  banner(text: string) {
    this.print(`\n${pc.bold(pc.magenta("🔥 " + text))}`);
    this.print(pc.dim("━".repeat(50)));
  }

  sprint(sprintId: string, title: string) {
    this.print(`\n${pc.bold(`🔨 ${sprintId}: ${title}`)}`);
  }

  attempt(n: number, max: number) {
    this.print(pc.dim(`  Attempt ${n}/${max}`));
  }

  criterion(id: string, desc: string, passed: boolean) {
    const icon = passed ? pc.green("✅") : pc.red("❌");
    this.print(`  ${icon} ${id}: ${desc}`);
  }

  sprintResult(sprintId: string, passed: boolean, attempts: number, durationMs: number) {
    const icon = passed ? pc.green("✅ PASS") : pc.red("❌ FAIL");
    const time = (durationMs / 1000).toFixed(1) + "s";
    this.print(`  ${sprintId}: ${icon} (${attempts} attempt${attempts > 1 ? "s" : ""}, ${time})`);
  }
}

export const logger = new Logger();
