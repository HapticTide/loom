import * as fs from "node:fs";
import * as path from "node:path";
import type { RoleFiles } from "./types.js";
import { resolveLoomWorkspace } from "./state.js";

/**
 * 加载任务工作区。
 *
 * 集中式架构 — 所有 loom 数据在 ~/.loom/projects/<project-name>/<task>/
 * 项目目录仅保留 .loom 软链接（指向 ~/.loom/projects/<name>/）。
 *
 * 目录结构约定:
 *   ~/.loom/projects/<project-name>/<task>/
 *       ├── spec.md
 *       ├── generator.md    ← 任务级（针对此任务定制）
 *       ├── evaluator.md    ← 任务级（针对此任务定制）
 *       ├── sprint-XX/feature-spec.md
 *       └── runs/           ← 运行时产物
 *
 * @param projectRoot 项目根目录
 * @param taskName 任务名称
 */
export async function loadWorkspace(projectRoot: string, taskName: string): Promise<{
  projectName: string;
  taskName: string;
  taskDir: string;
  projectRoot: string;
  runsDir: string;
  spec: string;
  roleFiles: RoleFiles;
  designLanguage: string;
}> {
  const absRoot = path.resolve(projectRoot);

  if (!fs.existsSync(absRoot)) {
    throw new LoomWorkspaceError(
      `Project root not found: ${absRoot}`
    );
  }

  // 解析 ~/.loom 工作区路径
  const { projectName, loomTaskDir, loomRunsDir } = resolveLoomWorkspace(absRoot, taskName);

  if (!fs.existsSync(loomTaskDir)) {
    throw new LoomWorkspaceError(
      `Task directory not found: ${loomTaskDir}`
    );
  }

  // spec.md 在 loomTaskDir 中
  const specPath = path.join(loomTaskDir, "spec.md");
  if (!fs.existsSync(specPath)) {
    throw new LoomWorkspaceError(
      `spec.md not found in task directory: ${loomTaskDir}`
    );
  }

  // 角色文件在 loomTaskDir 中（任务级，针对此任务定制）
  const roleFileNames = ["generator.md", "evaluator.md"] as const;
  const missing: string[] = [];

  for (const name of roleFileNames) {
    if (!fs.existsSync(path.join(loomTaskDir, name))) {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    throw new LoomWorkspaceError(
      `Missing role files in ${loomTaskDir}:\n` +
      missing.map((f) => `  - ${f}`).join("\n")
    );
  }

  const spec = fs.readFileSync(specPath, "utf-8");
  const roleFiles: RoleFiles = {
    generator: fs.readFileSync(path.join(loomTaskDir, "generator.md"), "utf-8"),
    evaluator: fs.readFileSync(path.join(loomTaskDir, "evaluator.md"), "utf-8"),
  };

  // design-language.md 是可选的设计语言文件 — 存在时注入所有 prompt
  const designLangPath = path.join(loomTaskDir, "design-language.md");
  const designLanguage = fs.existsSync(designLangPath)
    ? fs.readFileSync(designLangPath, "utf-8")
    : "";

  return {
    projectName,
    taskName,
    taskDir: loomTaskDir,
    projectRoot: absRoot,
    runsDir: loomRunsDir,
    spec,
    roleFiles,
    designLanguage,
  };
}

/** 获取 sprint 级别的运行时产物目录，按需创建 */
export function getSprintRunsDir(runsDir: string, sprintId: string): string {
  const dir = path.join(runsDir, sprintId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export class LoomWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoomWorkspaceError";
  }
}
