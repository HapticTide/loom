/**
 * config.ts — CLI 参数解析与配置构建
 *
 * 解析 CLI 子命令（run / negotiate / execute / status）及选项，
 * 构建 LoomConfig 供运行时使用。
 */

import type { LoomConfig } from "./types.js";
import { loadWorkspace } from "./workspace.js";

// --- CLI 命令类型 ---

const SAFE_NAME = /^[a-zA-Z0-9_-]+$/;

function validateName(value: string, label: string): void {
  if (!SAFE_NAME.test(value)) {
    console.error(`Error: invalid ${label} "${value}" — only letters, digits, hyphens, underscores allowed`);
    process.exit(1);
  }
}

export type CliCommand =
  | { type: "run"; taskName: string; projectRoot: string; verbose: boolean; runtime?: string; generatorRuntime?: string; evaluatorRuntime?: string }
  | { type: "negotiate"; taskName: string; sprintId: string; projectRoot: string; verbose: boolean; runtime?: string; generatorRuntime?: string; evaluatorRuntime?: string }
  | { type: "execute"; taskName: string; sprintId: string; projectRoot: string; verbose: boolean; runtime?: string; generatorRuntime?: string; evaluatorRuntime?: string }
  | { type: "status"; taskName: string; projectRoot: string }
  | { type: "help" };

/** 解析 CLI 参数为子命令结构体 */
export function parseCliArgs(args: string[]): CliCommand {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return { type: "help" };
  }

  const subcommand = args[0];
  const rest = args.slice(1);

  switch (subcommand) {
    case "run":
      return parseRunArgs(rest);
    case "negotiate":
      return parseSprintArgs("negotiate", rest);
    case "execute":
      return parseSprintArgs("execute", rest);
    case "status":
      return parseStatusArgs(rest);
    default:
      // 向后兼容：无子命令时视为 run
      if (!subcommand.startsWith("-")) {
        return parseRunArgs(args);
      }
      return { type: "help" };
  }
}

function extractCommonArgs(args: string[]): {
  verbose: boolean;
  runtime?: string;
  generatorRuntime?: string;
  evaluatorRuntime?: string;
  projectRoot: string;
  positional: string[];
} {
  let verbose = false;
  let runtime: string | undefined;
  let generatorRuntime: string | undefined;
  let evaluatorRuntime: string | undefined;
  let projectRoot = process.cwd();
  const positional: string[] = [];

  for (const arg of args) {
    if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (arg.startsWith("--runtime=")) {
      runtime = arg.split("=")[1];
    } else if (arg.startsWith("--generator-runtime=")) {
      generatorRuntime = arg.split("=")[1];
    } else if (arg.startsWith("--evaluator-runtime=")) {
      evaluatorRuntime = arg.split("=")[1];
    } else if (arg.startsWith("--project=")) {
      projectRoot = arg.split("=")[1];
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  return { verbose, runtime, generatorRuntime, evaluatorRuntime, projectRoot, positional };
}

function parseRunArgs(args: string[]): CliCommand {
  const { verbose, runtime, generatorRuntime, evaluatorRuntime, projectRoot, positional } = extractCommonArgs(args);

  const taskName = positional[0] ?? "";
  if (!taskName) {
    console.error("Error: task name is required\n");
    printHelp();
    process.exit(1);
  }
  validateName(taskName, "task name");

  return { type: "run", taskName, projectRoot, verbose, runtime, generatorRuntime, evaluatorRuntime };
}

function parseSprintArgs(type: "negotiate" | "execute", args: string[]): CliCommand {
  const { verbose, runtime, generatorRuntime, evaluatorRuntime, projectRoot, positional } = extractCommonArgs(args);

  // 期望格式: <task-name> <sprint-id>  或  <task-name>/<sprint-id>
  let taskName = "";
  let sprintId = "";

  if (positional.length >= 2) {
    taskName = positional[0];
    sprintId = positional[1];
  } else if (positional.length === 1 && positional[0].includes("/")) {
    const parts = positional[0].split("/");
    taskName = parts[0];
    sprintId = parts[1];
  }

  if (!taskName || !sprintId) {
    console.error(`Error: task name and sprint ID are required\n`);
    console.error(`  Usage: loom ${type} <task-name> <sprint-id>`);
    console.error(`  Or:    loom ${type} <task-name>/<sprint-id>\n`);
    printHelp();
    process.exit(1);
  }
  validateName(taskName, "task name");
  validateName(sprintId, "sprint ID");

  return { type, taskName, sprintId, projectRoot, verbose, runtime, generatorRuntime, evaluatorRuntime };
}

function parseStatusArgs(args: string[]): CliCommand {
  const { projectRoot, positional } = extractCommonArgs(args);
  const taskName = positional[0] ?? "";
  if (!taskName) {
    console.error("Error: task name is required\n");
    printHelp();
    process.exit(1);
  }
  validateName(taskName, "task name");
  return { type: "status", taskName, projectRoot };
}

/** 从 CLI 参数构建完整的 LoomConfig（加载工作区文件） */
export async function resolveConfig(cliArgs: { projectRoot: string; taskName: string; verbose: boolean }): Promise<LoomConfig> {
  const workspace = await loadWorkspace(cliArgs.projectRoot, cliArgs.taskName);

  return {
    projectName: workspace.projectName,
    taskName: workspace.taskName,
    taskDir: workspace.taskDir,
    projectRoot: workspace.projectRoot,
    runsDir: workspace.runsDir,
    spec: workspace.spec,
    roleFiles: workspace.roleFiles,
    designLanguage: workspace.designLanguage,
    verbose: cliArgs.verbose,
  };
}

/** 打印帮助信息 */
export function printHelp() {
  console.log(`
🔥 Loom -- Self-weaving Code Workshop

Usage:
  loom run <task-name> [options]                  Run the full pipeline
  loom negotiate <task-name> <sprint-id> [options] Negotiate a single Sprint contract
  loom execute <task-name> <sprint-id> [options]   Execute a single Sprint (implement+verify)
  loom status <task-name>                          View task status
  loom --help                                      Show help

Arguments:
  <task-name>    Task name (e.g., add-auth, refactor-db)
  <sprint-id>    Sprint ID (e.g., sprint-01)

Options:
  --project=<path>   Specify project root (default: current working directory)
  --runtime=<name>   Specify agent runtime shared by both roles
                     Presets: claude, codex, gemini
  --generator-runtime=<name>  Specify Generator runtime separately
  --evaluator-runtime=<name>  Specify Evaluator runtime separately
  --verbose, -v      Verbose log output
  --help, -h         Show help

Environment Variables:
  LOOM_RUNTIME              Preset name for both roles (claude, codex, gemini)
  LOOM_GENERATOR_RUNTIME    Preset name for Generator only
  LOOM_EVALUATOR_RUNTIME    Preset name for Evaluator only
  LOOM_MAX_SPRINTS    Max number of sprints (default: 20)
  LOOM_MAX_RETRIES    Max retries per sprint (default: 3)
  LOOM_MAX_NEGOTIATION_ROUNDS  Max negotiation rounds (default: 10)

Runtime Detection Priority:
  1. LOOM_RUNTIME environment variable / --runtime argument
  2. Auto-detect installed presets in PATH (claude -> codex -> gemini)

Directory Structure (centralized):
  ~/.loom/
  ├── index.json          # Global project index (monitoring entry point)
  └── projects/
      └── <project-id>/   # Per-project isolation
          └── <task>/
              ├── spec.md           # Requirements document
              ├── generator.md      # Generator role instructions
              ├── evaluator.md      # Evaluator role instructions
              ├── state.json        # Task state
              ├── sprint-XX/
              │   └── feature-spec.md
              └── runs/             # Runtime artifacts
`);
}
