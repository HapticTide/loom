/**
 * orchestrator.ts — Loom 编排器
 *
 * 发现 Sprint 目录 → 顺序执行每个 Sprint（协商 + 实现 + 验证）→ 生成最终报告。
 * Sprint 间为串行依赖：前一个失败则停止后续 Sprint。
 */

import type { LoomConfig, LoomResult, SprintResult } from "./types.js";
import { MAX_SPRINTS } from "./types.js";
import type { Runtimes } from "./runtime.js";
import { executeSprint } from "./sprint-executor.js";
import { generateReport } from "./reporter.js";
import { updateLessons } from "./lessons.js";
import { logger } from "./logger.js";
import { git, isGitRepo } from "./git.js";
import { loadTaskState, saveTaskState, syncIndex, createTaskState } from "./state.js";
import * as fs from "node:fs";
import * as path from "node:path";

/** 检查 sprint 是否已完成（git tag 存在） */
function isSprintDone(projectRoot: string, taskName: string, sprintId: string): boolean {
  try {
    const result = git(projectRoot, ["tag", "-l", `loom/${taskName}/${sprintId}/done`]);
    return result.length > 0;
  } catch {
    return false;
  }
}

/** Loom 主执行流程：发现 Sprint → 顺序执行 → 生成报告 */
export async function runLoom(config: LoomConfig, runtimes: Runtimes): Promise<LoomResult> {
  const startTime = Date.now();

  if (config.verbose) {
    logger.setLevel("debug");
  }

  logger.setLogFile(path.join(config.runsDir, "loom.log"));
  runtimes.generator.setLogFile(path.join(config.runsDir, "generator.log"));
  runtimes.evaluator.setLogFile(path.join(config.runsDir, "evaluator.log"));

  logger.banner("Loom -- Self-weaving Code Workshop");
  logger.info("Orchestrator", `Project: ${config.projectRoot}`);
  logger.info("Orchestrator", `Task: ${config.taskName} (${config.taskDir})`);
  logger.info("Orchestrator", `Generator: ${runtimes.generator.name}, Evaluator: ${runtimes.evaluator.name}`);

  // Loom 要求 git 仓库（tag、commit、reset 均依赖 git）
  if (!isGitRepo(config.projectRoot)) {
    throw new Error(
      `projectRoot is not a git repository: ${config.projectRoot}\n` +
      `Loom requires git to manage Sprint state. Please run inside a git repo (or worktree).`
    );
  }

  let taskState = loadTaskState(config.projectName, config.taskName);
  if (!taskState) {
    taskState = createTaskState(config.projectName, config.projectRoot, config.taskName);
  }
  taskState.status = "executing";
  saveTaskState(taskState);
  syncIndex(taskState);

  // 发现 sprint 目录
  const sprintIds = discoverSprints(config.taskDir);

  if (sprintIds.length === 0) {
    logger.error(
      "Orchestrator",
      "No sprint directories found. " +
      "Expected sprint-XX/feature-spec.md directories in the task directory. " +
      "The coding agent should create these before running loom."
    );
    return {
      success: false,
      sprints: [],
      totalDurationMs: Date.now() - startTime,
      taskDir: config.taskDir,
    };
  }

  const activeSprints = sprintIds.slice(0, MAX_SPRINTS);
  logger.info("Orchestrator", `Found ${activeSprints.length} sprints to execute`);

  logger.banner("Sprint Execution");
  const sprintResults: SprintResult[] = [];
  let skippedCount = 0;

  for (let i = 0; i < activeSprints.length; i++) {
    const sprintId = activeSprints[i];

    if (isSprintDone(config.projectRoot, config.taskName, sprintId)) {
      logger.info("Orchestrator", `Sprint ${sprintId} already done, skipping`);
      sprintResults.push({ sprintId, success: true, attempts: 0, durationMs: 0 });
      skippedCount++;
      continue;
    }

    const featureSpecPath = path.join(config.taskDir, sprintId, "feature-spec.md");
    if (!fs.existsSync(featureSpecPath)) {
      logger.error("Orchestrator", `Feature spec not found: ${featureSpecPath}`);
      sprintResults.push({ sprintId, success: false, attempts: 0, durationMs: 0 });
      continue;
    }

    const featureSpecContent = fs.readFileSync(featureSpecPath, "utf-8");
    const titleMatch = featureSpecContent.match(/^#\s+Sprint\s+\d+:\s+(.+)$/m);
    const title = titleMatch?.[1] ?? sprintId;
    logger.sprint(sprintId, title);

    const result = await executeSprint(runtimes, sprintId, config);
    sprintResults.push(result);

    logger.sprintResult(sprintId, result.success, result.attempts, result.durationMs);

    if (!result.success) {
      logger.error(
        "Orchestrator",
        `Sprint ${sprintId} failed. Stopping (subsequent sprints depend on this one).`
      );
      break;
    }
  }

  if (skippedCount > 0) {
    logger.info("Orchestrator", `${skippedCount} sprints skipped (previously completed)`);
  }

  logger.banner("Final Report");
  const loomResult: LoomResult = {
    success: sprintResults.every((r) => r.success),
    sprints: sprintResults,
    totalDurationMs: Date.now() - startTime,
    taskDir: config.taskDir,
  };

  try {
    runtimes.evaluator.setLogFile(path.join(config.runsDir, "reporter.log"));
    await generateReport(loomResult, config, runtimes.evaluator);
  } catch (err) {
    logger.error("Orchestrator", `Report generation failed: ${err}`);
  }

  // Post-mortem：提炼项目级通用教训到 lessons.md
  try {
    runtimes.evaluator.setLogFile(path.join(config.runsDir, "postmortem.log"));
    await updateLessons(loomResult, config, runtimes.evaluator);
  } catch (err) {
    logger.warn("Orchestrator", `Post-mortem analysis failed (non-fatal): ${err}`);
  }

  const passed = sprintResults.filter((r) => r.success).length;
  const total = sprintResults.length;
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  logger.banner("Summary");
  for (const r of sprintResults) {
    logger.sprintResult(r.sprintId, r.success, r.attempts, r.durationMs);
  }
  console.log();
  logger.info("Orchestrator", `Result: ${passed}/${total} sprints passed`);
  logger.info("Orchestrator", `Total time: ${totalTime}s`);
  logger.info("Orchestrator", `Output dir: ${config.taskDir}`);

  taskState.status = loomResult.success ? "done" : "failed";
  for (const r of sprintResults) {
    taskState.sprints[r.sprintId] = {
      status: r.success ? "passed" : "failed",
      attempts: r.attempts,
      durationMs: r.durationMs,
    };
  }
  saveTaskState(taskState);
  syncIndex(taskState);

  return loomResult;
}

/** 发现包含 feature-spec.md 的 sprint 目录 */
function discoverSprints(taskDir: string): string[] {
  const sprintIds: string[] = [];

  if (!fs.existsSync(taskDir)) return sprintIds;

  const entries = fs.readdirSync(taskDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith("sprint-")) {
      const featureSpecPath = path.join(taskDir, entry.name, "feature-spec.md");
      if (fs.existsSync(featureSpecPath)) {
        sprintIds.push(entry.name);
      }
    }
  }

  sprintIds.sort();
  return sprintIds;
}
