/**
 * state.ts — Loom 集中式状态管理
 *
 * 所有 loom 运行时数据存储在 ~/.loom/projects/<project-name>/<task>/
 * 项目目录仅保留 .loom 软链接（指向 ~/.loom/projects/<name>/）。
 *
 * 职责：
 *   1. 项目名称派生（目录名）
 *   2. ~/.loom 目录结构管理
 *   3. 全局索引维护（~/.loom/index.json）
 *   4. 任务/Sprint 状态机
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { logger } from "./logger.js";

// --- 路径常量 ---

/** ~/.loom 根目录 */
export function getLoomHome(): string {
  return path.join(os.homedir(), ".loom");
}

// --- 状态类型 ---

export type TaskStatus = "created" | "planning" | "ready" | "executing" | "done" | "failed";
export type SprintStatus = "pending" | "negotiating" | "contracted" | "executing" | "passed" | "failed";

export interface SprintState {
  status: SprintStatus;
  attempts: number;
  durationMs: number;
}

export interface TaskState {
  status: TaskStatus;
  projectName: string;
  projectRoot: string;
  taskName: string;
  sprints: Record<string, SprintState>;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectIndexEntry {
  path: string;
  tasks: Record<string, { status: TaskStatus; sprints: number; completed: number }>;
}

export interface LoomIndex {
  projects: Record<string, ProjectIndexEntry>;
}

// --- 项目名称派生 ---

/** 从项目根目录派生项目名称 */
export function deriveProjectName(projectRoot: string): string {
  const absPath = path.resolve(projectRoot);

  // 优先从已有 .loom 软链接推导（确保一致性）
  const symlinkPath = path.join(absPath, ".loom");
  try {
    const stat = fs.lstatSync(symlinkPath);
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(symlinkPath);
      const match = target.match(/projects\/([^/]+)\/?$/);
      if (match) return match[1];
    }
  } catch {
    // 无软链接，回退到后续策略
  }

  // 用 git common dir 派生（所有 worktree 共享同一个 .git，天然稳定）
  try {
    const commonDir = execSync("git rev-parse --path-format=absolute --git-common-dir", {
      cwd: absPath,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    }).trim();
    // commonDir 始终指向主仓库的 .git 目录（如 /Users/x/my-app/.git），无论是主仓库还是 worktree
    // 去掉尾部 /.git 取主仓库目录名
    const gitRoot = commonDir.replace(/\/\.git(\/.*)?$/, "");
    const dirName = path.basename(gitRoot);
    if (dirName) {
      return dirName.replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-").toLowerCase();
    }
  } catch {
    // 非 git 仓库，回退到目录名
  }

  const dirName = path.basename(absPath);
  return dirName.replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-").toLowerCase();
}

// --- 目录结构管理 ---

/** 获取项目在 ~/.loom 中的目录 */
export function getProjectDir(projectName: string): string {
  return path.join(getLoomHome(), "projects", projectName);
}

/** 获取任务在 ~/.loom 中的目录 */
export function getTaskDir(projectName: string, taskName: string): string {
  return path.join(getProjectDir(projectName), taskName);
}

/** 获取任务的 runs 目录 */
export function getRunsDir(projectName: string, taskName: string): string {
  return path.join(getTaskDir(projectName, taskName), "runs");
}

// --- .gitignore 管理 ---

/** 确保 .loom 在项目根 .gitignore 中 */
export function ensureLoomGitignore(projectRoot: string): void {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const entry = ".loom";

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    if (content.includes(entry)) return;
    fs.appendFileSync(gitignorePath, `\n# Loom\n${entry}\n`);
  } else {
    fs.writeFileSync(gitignorePath, `# Loom\n${entry}\n`);
  }
}

// --- 任务状态管理 ---

/** 获取任务状态文件路径 */
function taskStatePath(projectName: string, taskName: string): string {
  return path.join(getTaskDir(projectName, taskName), "state.json");
}

/** 加载任务状态 */
export function loadTaskState(projectName: string, taskName: string): TaskState | null {
  const p = taskStatePath(projectName, taskName);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (err) {
    logger.warn("State", `无法解析 ${p}: ${err}`);
    return null;
  }
}

/** 保存任务状态 */
export function saveTaskState(state: TaskState): void {
  const dir = getTaskDir(state.projectName, state.taskName);
  fs.mkdirSync(dir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(taskStatePath(state.projectName, state.taskName), JSON.stringify(state, null, 2) + "\n");
}

/** 创建初始任务状态 */
export function createTaskState(projectName: string, projectRoot: string, taskName: string): TaskState {
  const now = new Date().toISOString();
  return {
    status: "created",
    projectName,
    projectRoot,
    taskName,
    sprints: {},
    createdAt: now,
    updatedAt: now,
  };
}

/** 更新 Sprint 状态 */
export function updateSprintState(
  state: TaskState,
  sprintId: string,
  sprintState: Partial<SprintState>,
): void {
  const current = state.sprints[sprintId] ?? { status: "pending", attempts: 0, durationMs: 0 };
  state.sprints[sprintId] = { ...current, ...sprintState };
}

// --- 全局索引 ---

const INDEX_PATH = () => path.join(getLoomHome(), "index.json");

/** 加载全局索引 */
export function loadIndex(): LoomIndex {
  const indexPath = INDEX_PATH();
  if (!fs.existsSync(indexPath)) return { projects: {} };
  try {
    return JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  } catch (err) {
    logger.warn("State", `无法解析 ${indexPath}: ${err}`);
    return { projects: {} };
  }
}

/** 保存全局索引 */
function saveIndex(index: LoomIndex): void {
  fs.mkdirSync(getLoomHome(), { recursive: true });
  fs.writeFileSync(INDEX_PATH(), JSON.stringify(index, null, 2) + "\n");
}

/** 从任务状态同步全局索引 */
export function syncIndex(state: TaskState): void {
  const index = loadIndex();

  if (!index.projects[state.projectName]) {
    index.projects[state.projectName] = { path: state.projectRoot, tasks: {} };
  }

  const sprintEntries = Object.values(state.sprints);
  index.projects[state.projectName].tasks[state.taskName] = {
    status: state.status,
    sprints: sprintEntries.length,
    completed: sprintEntries.filter(s => s.status === "passed").length,
  };

  saveIndex(index);
}

// --- 初始化工作区 ---

/** 创建软链接：project/.loom → ~/.loom/projects/<name>/ */
function ensureProjectSymlink(projectRoot: string, projectName: string): void {
  const symlinkPath = path.join(projectRoot, ".loom");
  const target = getProjectDir(projectName);

  try {
    if (fs.existsSync(symlinkPath)) {
      // 已存在：检查是否是正确的软链接
      const stat = fs.lstatSync(symlinkPath);
      if (stat.isSymbolicLink()) {
        const current = fs.readlinkSync(symlinkPath);
        if (current === target) return; // 已正确
        // 指向错误目标，重建
        fs.unlinkSync(symlinkPath);
      } else {
        // 是真实目录/文件，不覆盖
        return;
      }
    }
    fs.symlinkSync(target, symlinkPath, "dir");
  } catch (err) {
    // 静默失败（Windows 需管理权限、某些文件系统不支持）
    logger.debug("State", `软链接创建失败: ${err}`);
  }
}

/**
 * 初始化/解析 loom 工作区。
 *
 * 给定 projectRoot + taskName：
 *   1. 确保 ~/.loom/projects/<name>/<task>/ 目录存在
 *   2. 创建 .loom 软链接 + .gitignore
 *   3. 返回所有解析后的路径
 */
export function resolveLoomWorkspace(projectRoot: string, taskName: string): {
  projectName: string;
  loomTaskDir: string;
  loomRunsDir: string;
} {
  const absRoot = path.resolve(projectRoot);

  // 确保 ~/.loom 存在
  fs.mkdirSync(path.join(getLoomHome(), "projects"), { recursive: true });

  const projectName = deriveProjectName(absRoot);
  ensureLoomGitignore(absRoot);

  // 确保任务目录
  const loomTaskDir = getTaskDir(projectName, taskName);
  const loomRunsDir = getRunsDir(projectName, taskName);
  fs.mkdirSync(loomRunsDir, { recursive: true });

  // 创建软链接：project/.loom → ~/.loom/projects/<name>/
  ensureProjectSymlink(absRoot, projectName);

  // 确保全局索引条目
  let state = loadTaskState(projectName, taskName);
  if (!state) {
    state = createTaskState(projectName, projectRoot, taskName);
    saveTaskState(state);
  }
  syncIndex(state);

  return { projectName, loomTaskDir, loomRunsDir };
}
