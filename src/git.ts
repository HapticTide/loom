/**
 * git.ts — Git 操作封装
 *
 * 提供安全的 git 命令执行（数组参数防 shell 注入）、Sprint ID 校验、仓库检测。
 */

import { execFileSync } from "node:child_process";

/** 在指定目录执行 git 命令（数组参数，防止 shell 注入） */
export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

/** 验证 sprint ID 格式（仅允许字母数字、连字符、下划线） */
export function validateSprintId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid sprint ID: ${id}`);
  }
}

/** 检测目录是否为 git 仓库 */
export function isGitRepo(cwd: string): boolean {
  try {
    git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}
