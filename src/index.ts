#!/usr/bin/env bun

/**
 * index.ts — CLI 入口 + 子命令分发
 *
 * 解析命令行参数，构建运行时配置，分发到相应的执行流程。
 * 子命令：run（完整流水线）、negotiate、execute、status。
 */

import { parseCliArgs, resolveConfig, printHelp } from "./config.js";
import { runLoom } from "./orchestrator.js";
import { executeSprint } from "./sprint-executor.js";
import { negotiateContract } from "./negotiator.js";
import { detectRuntime, createRuntime, type Runtimes } from "./runtime.js";
import { logger } from "./logger.js";
import { resolveLoomWorkspace, getTaskDir, loadIndex } from "./state.js";
import * as fs from "node:fs";
import * as path from "node:path";

/** 从 CLI 参数构建 Runtimes 对象 — generator 和 evaluator 必须是独立实例 */
function resolveRuntimes(cmd: { runtime?: string; generatorRuntime?: string; evaluatorRuntime?: string }): Runtimes {
  const genName = cmd.generatorRuntime ?? cmd.runtime ?? process.env.LOOM_GENERATOR_RUNTIME;
  const evalName = cmd.evaluatorRuntime ?? cmd.runtime ?? process.env.LOOM_EVALUATOR_RUNTIME;
  return {
    generator: genName ? createRuntime(genName) : detectRuntime(),
    evaluator: evalName ? createRuntime(evalName) : detectRuntime(),
  };
}

async function main() {
  // 优雅关闭
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`\n⚠️  Received ${signal}, shutting down...`);
    logger.close();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    console.error(`\n❌ Unhandled promise rejection: ${reason}\n`);
    logger.close();
    process.exit(2);
  });

  const args = process.argv.slice(2);
  const command = parseCliArgs(args);

  if (command.type === "help") {
    printHelp();
    return;
  }

  try {
    switch (command.type) {
      case "run": {
        const config = await resolveConfig({ projectRoot: command.projectRoot, taskName: command.taskName, verbose: command.verbose });
        const runtimes = resolveRuntimes(command);
        const result = await runLoom(config, runtimes);
        process.exit(result.success ? 0 : 1);
      }

      case "negotiate": {
        const runtimes = resolveRuntimes(command);
        if (command.verbose) logger.setLevel("debug");
        const config = await resolveConfig({ projectRoot: command.projectRoot, taskName: command.taskName, verbose: command.verbose });
        const sprintDir = path.join(config.taskDir, command.sprintId);
        logger.setLogFile(path.join(config.runsDir, "loom.log"));
        runtimes.generator.setLogFile(path.join(config.runsDir, "generator.log"));
        runtimes.evaluator.setLogFile(path.join(config.runsDir, "evaluator.log"));
        logger.banner("Loom -- Contract Negotiation");
        logger.info("Negotiate", `Sprint: ${command.sprintId}`);
        logger.info("Negotiate", `Generator: ${runtimes.generator.name}, Evaluator: ${runtimes.evaluator.name}`);
        const negResult = await negotiateContract(runtimes, sprintDir, config);
        if (negResult.forcedApproval) {
          logger.warn("Negotiate", `Contract force-approved after ${negResult.rounds} rounds`);
        } else {
          logger.info("Negotiate", `Contract approved after ${negResult.rounds} rounds ✅`);
        }
        break;
      }

      case "execute": {
        const runtimes = resolveRuntimes(command);
        if (command.verbose) logger.setLevel("debug");
        const config = await resolveConfig({ projectRoot: command.projectRoot, taskName: command.taskName, verbose: command.verbose });
        logger.setLogFile(path.join(config.runsDir, "loom.log"));
        runtimes.generator.setLogFile(path.join(config.runsDir, "generator.log"));
        runtimes.evaluator.setLogFile(path.join(config.runsDir, "evaluator.log"));
        logger.banner("Loom -- Sprint Execution");
        logger.info("Execute", `Sprint: ${command.sprintId}`);
        logger.info("Execute", `Project: ${config.projectRoot}`);
        logger.info("Execute", `Generator: ${runtimes.generator.name}, Evaluator: ${runtimes.evaluator.name}`);
        const result = await executeSprint(runtimes, command.sprintId, config);
        logger.sprintResult(command.sprintId, result.success, result.attempts, result.durationMs);
        if (!result.success) process.exit(1);
        break;
      }

      case "status": {
        const absRoot = path.resolve(command.projectRoot);
        const { projectName, loomTaskDir } = resolveLoomWorkspace(absRoot, command.taskName);
        printStatus(loomTaskDir, command.taskName);
        break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const cleanMsg = msg.length > 500 ? msg.slice(0, 500) + "..." : msg;
    console.error(`\n❌ Fatal error: ${cleanMsg}\n`);
    process.exit(2);
  }
}

function printStatus(taskDir: string, taskName: string): void {
  if (!fs.existsSync(taskDir)) {
    console.error(`Task directory not found: ${taskDir}`);
    process.exit(1);
  }

  console.log(`\n🔥 Loom -- Task Status\n`);
  console.log(`Task: ${taskName}`);
  console.log(`Dir: ${taskDir}\n`);

  for (const file of ["spec.md", "generator.md", "evaluator.md"]) {
    console.log(`  ${fs.existsSync(path.join(taskDir, file)) ? "✅" : "❌"} ${file}`);
  }
  console.log();

  const sprints = fs.readdirSync(taskDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("sprint-"))
    .map((e) => e.name)
    .sort();

  if (sprints.length === 0) {
    console.log("  No sprint directories found.");
    return;
  }

  console.log(`Found ${sprints.length} sprints:\n`);
  console.log("  Sprint          | Feature Spec | Contract | Eval Report");
  console.log("  ────────────────|──────────────|──────────|────────────");

  for (const sprint of sprints) {
    const dir = path.join(taskDir, sprint);
    const mark = (f: string) => fs.existsSync(path.join(dir, f)) ? "✅" : "  ";
    console.log(
      `  ${sprint.padEnd(16)}| ${mark("feature-spec.md").padEnd(13)}| ${mark("contract.md").padEnd(9)}| ${mark("eval-report.md")}`
    );
  }

  if (fs.existsSync(path.join(taskDir, "final-report.md"))) {
    console.log(`\n  📄 final-report.md generated`);
  }
  console.log();
}

main();
