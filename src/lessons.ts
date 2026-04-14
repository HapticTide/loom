/**
 * lessons.ts — 项目级 post-mortem 知识管理
 *
 * 任务完成后提炼项目级通用教训，写入 ~/.loom/projects/<name>/lessons.md。
 * 每条带日期标记，上限 4KB，Agent 每次重写整份文件（非追加），自然淘汰过时内容。
 * 新任务启动时注入 Generator/Evaluator prompt，避免跨任务重复踩坑。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentRuntime } from "./runtime.js";
import type { LoomConfig, LoomResult } from "./types.js";
import { getProjectDir } from "./state.js";
import { logger } from "./logger.js";

const LESSONS_FILE = "lessons.md";
const MAX_LESSONS_BYTES = 4 * 1024;

/** 加载项目级 lessons.md（如果存在） */
export function loadLessons(projectName: string): string {
  const lessonsPath = path.join(getProjectDir(projectName), LESSONS_FILE);
  if (fs.existsSync(lessonsPath)) {
    return fs.readFileSync(lessonsPath, "utf-8");
  }
  return "";
}

/** 任务完成后执行 post-mortem，重写 lessons.md */
export async function updateLessons(
  result: LoomResult,
  config: LoomConfig,
  runtime: AgentRuntime,
): Promise<void> {
  const projectDir = getProjectDir(config.projectName);
  const lessonsPath = path.join(projectDir, LESSONS_FILE);
  const currentLessons = loadLessons(config.projectName);

  // 收集本次任务的 eval reports 摘要
  const evalSummaries: string[] = [];
  for (const s of result.sprints) {
    const reportPath = path.join(config.taskDir, s.sprintId, "eval-report.md");
    if (fs.existsSync(reportPath)) {
      const content = fs.readFileSync(reportPath, "utf-8");
      // 只取前 2000 字符避免 prompt 过大
      evalSummaries.push(`### ${s.sprintId} (${s.success ? "PASS" : "FAIL"})\n${content.slice(0, 2000)}`);
    }
  }

  // 加载 context.md（跨 Sprint 失败约束）
  const contextPath = path.join(config.taskDir, "context.md");
  const context = fs.existsSync(contextPath) ? fs.readFileSync(contextPath, "utf-8") : "";

  const today = new Date().toISOString().slice(0, 10);

  const prompt = `TASK: You are performing a post-mortem analysis for a completed loom task.

Your job is to update the project-level lessons file. This file captures **project-wide, reusable knowledge** — things that ANY future task in this project should know.

## Rules

1. **Only keep project-level universal knowledge**, such as:
   - Environment/toolchain constraints ("use Bun, not Node")
   - Code conventions/architecture patterns ("API returns { data, error }")
   - Recurring pitfalls ("must run seed after migration")
2. **Do NOT keep task-specific details**, such as:
   - Implementation details of this specific task
   - Specific bug fixes or workarounds for this task only
3. **If the final result is an empty file** (no valid lessons remain — neither new nor old), **output EMPTY** (literally the word EMPTY, nothing else). If old lessons are still valid but this task adds nothing new, output the old lessons with updated dates — do NOT output EMPTY
4. Each lesson entry must be prefixed with [${today}] — this is the last-verified date
5. If a lesson from the existing file is still valid, keep it and update its date to [${today}]
6. If a lesson is outdated or no longer applicable, remove it
7. **Rewrite the entire file** — do not append. Merge, deduplicate, and keep only what matters
8. Maximum total output: 4KB. Be concise. Prioritize by impact.

## Current lessons.md

${currentLessons || "(empty — no existing lessons)"}

## This Task's Context (cross-sprint constraints and deliverables)

${context.slice(0, 3000) || "(no context)"}

## This Task's Evaluation Reports

${evalSummaries.join("\n\n").slice(0, 4000) || "(no reports)"}

## Output Format

Output the complete new lessons.md content directly. Use this structure:

\`\`\`
# Project Lessons

## Environment & Toolchain
- [YYYY-MM-DD] lesson here

## Code Conventions
- [YYYY-MM-DD] lesson here

## Known Pitfalls
- [YYYY-MM-DD] lesson here
\`\`\`

Sections with no entries should be omitted. If no lessons at all, output EMPTY.

NOTE: You are running in HEADLESS mode. Output the file content directly as your response — do NOT write to any files.`;

  logger.info("PostMortem", "Analyzing task for project-level lessons...");

  const agentResult = await runtime.run({ prompt, workDir: config.projectRoot });

  if (agentResult.exitCode !== 0 && !agentResult.response.trim()) {
    logger.warn("PostMortem", `Agent not responding (exit code: ${agentResult.exitCode}), skipping`);
    return;
  }

  const response = agentResult.response.trim();

  // Agent 判定最终 lessons 为空（所有旧 lessons 已过时且无新增）
  if (response === "EMPTY" || response === "") {
    logger.info("PostMortem", "No project-level lessons remain");
    if (currentLessons) {
      fs.unlinkSync(lessonsPath);
      logger.info("PostMortem", "Cleared outdated lessons.md");
    }
    return;
  }

  // 提取 markdown 内容（Agent 可能包裹在 ```markdown ... ``` 中）
  let content = response;
  const fenceMatch = response.match(/```(?:markdown|md)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    content = fenceMatch[1];
  }

  // 强制 4KB 上限（按 UTF-8 字节数截断）
  if (Buffer.byteLength(content, "utf-8") > MAX_LESSONS_BYTES) {
    const buf = Buffer.from(content, "utf-8").subarray(0, MAX_LESSONS_BYTES);
    content = buf.toString("utf-8");
    // 修复可能被截断的多字节字符（末尾 replacement char）
    if (content.endsWith("\uFFFD")) {
      content = content.slice(0, content.lastIndexOf("\uFFFD"));
    }
    // 在最后一个完整行处截断
    const lastNewline = content.lastIndexOf("\n");
    if (lastNewline > 0) content = content.slice(0, lastNewline);
  }

  fs.writeFileSync(lessonsPath, content + "\n");
  logger.info("PostMortem", `Lessons updated: ${lessonsPath}`);
}
