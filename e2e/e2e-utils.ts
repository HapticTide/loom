/**
 * E2E 测试工具：管理 fixture 复制、Loom 运行、输出收集
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spyOn } from "bun:test";
import { resolveConfig } from "../src/config.js";
import { runLoom } from "../src/orchestrator.js";
import { createRuntime } from "../src/runtime.js";
import { deriveProjectName, getTaskDir } from "../src/state.js";
import type { LoomResult } from "../src/types.js";

/** 默认 E2E runtime — 可通过 LOOM_E2E_RUNTIME 环境变量覆盖 */
const DEFAULT_RUNTIME = process.env.LOOM_E2E_RUNTIME ?? "codex";

export interface E2ERunOptions {
  taskName?: string;
  runtime?: string;
}

export interface E2ERunResult {
  loomResult: LoomResult | null;
  error: Error | null;
  projectDir: string;
  taskDir: string;
  /** 任务目录下的文件 */
  outputFiles: string[];
  /** 项目根目录下生成的代码文件（排除 .loom 和 .git/） */
  projectFiles: string[];
  fileContents: Record<string, string>;
  durationMs: number;
  /** 临时 home 目录（测试清理用） */
  fakeHome: string;
  /** homedir spy（清理时恢复） */
  _homedirSpy: ReturnType<typeof spyOn>;
}

/**
 * 将 fixture 目录复制到临时位置并运行 Loom
 *
 * Fixture 中的 .loom/<task>/ 内容会被移动到 fakeHome/.loom/ 中
 */
export async function runE2E(
  fixtureName: string,
  opts?: E2ERunOptions,
): Promise<E2ERunResult> {
  const fixtureDir = path.join(import.meta.dir, "fixtures", fixtureName);
  if (!fs.existsSync(fixtureDir)) {
    throw new Error(`Fixture not found: ${fixtureDir}`);
  }

  // 复制 fixture 到临时项目目录
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `loom-e2e-${fixtureName}-`));
  copyDirSync(fixtureDir, tmpDir);

  // 设置临时 home 目录（mock os.homedir）
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "loom-e2e-home-"));
  const homedirSpy = spyOn(os, "homedir").mockReturnValue(fakeHome);

  // 发现 fixture 中的 .loom/<task>/ 并移动到 fakeHome/.loom/
  const fixtureLoomDir = path.join(tmpDir, ".loom");
  const resolvedTaskName = opts?.taskName ?? autoDiscoverTask(fixtureLoomDir);
  const projectName = deriveProjectName(tmpDir);
  const loomTaskDir = getTaskDir(projectName, resolvedTaskName);
  fs.mkdirSync(loomTaskDir, { recursive: true });

  // 复制 .loom/<task>/ 内容到 fakeHome/.loom/
  const srcTaskDir = path.join(fixtureLoomDir, resolvedTaskName);
  copyDirSync(srcTaskDir, loomTaskDir);

  // 删除项目内的 .loom/ 目录（不再需要）
  fs.rmSync(fixtureLoomDir, { recursive: true, force: true });

  // 初始化 git repo（loom 和部分 agent 需要 git 上下文）
  const { execFileSync } = await import("node:child_process");
  execFileSync("git", ["init"], { cwd: tmpDir, stdio: "ignore" });
  execFileSync("git", ["add", "-A"], { cwd: tmpDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "e2e fixture", "--allow-empty"], { cwd: tmpDir, stdio: "ignore" });

  const startTime = Date.now();

  let loomResult: LoomResult | null = null;
  let error: Error | null = null;

  try {
    const config = await resolveConfig({ projectRoot: tmpDir, taskName: resolvedTaskName, verbose: true });
    const runtimeName = opts?.runtime ?? DEFAULT_RUNTIME;
    const runtime = createRuntime(runtimeName);
    loomResult = await runLoom(config, { generator: runtime, evaluator: runtime });
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
  }

  const durationMs = Date.now() - startTime;

  // 收集输出文件（loomTaskDir 内的产物）
  const outputFiles = collectFiles(loomTaskDir);
  const fileContents: Record<string, string> = {};

  for (const relPath of outputFiles) {
    const absPath = path.join(loomTaskDir, relPath);
    readFileContent(absPath, relPath, fileContents);
  }

  // 收集项目根目录下生成的代码文件（排除 .loom 和 .git/）
  const projectFiles = collectFiles(tmpDir).filter(
    (f) => !f.startsWith(".loom") && !f.startsWith(".git/") && f !== ".gitignore"
  );

  for (const relPath of projectFiles) {
    const absPath = path.join(tmpDir, relPath);
    const key = `project:${relPath}`;
    readFileContent(absPath, key, fileContents);
  }

  return {
    loomResult,
    error,
    projectDir: tmpDir,
    taskDir: loomTaskDir,
    outputFiles,
    projectFiles,
    fileContents,
    durationMs,
    fakeHome,
    _homedirSpy: homedirSpy,
  };
}

/** 清理临时目录 */
export function cleanupE2E(result: E2ERunResult): void {
  // 恢复 os.homedir
  result._homedirSpy.mockRestore();
  if (result.projectDir.startsWith(os.tmpdir())) {
    fs.rmSync(result.projectDir, { recursive: true, force: true });
  }
  if (result.fakeHome && result.fakeHome.startsWith(os.tmpdir())) {
    fs.rmSync(result.fakeHome, { recursive: true, force: true });
  }
}

/** 打印运行结果摘要 */
export function printSummary(result: E2ERunResult): string {
  const lines: string[] = [];
  const sep = "\u2500".repeat(60);

  lines.push(sep);
  lines.push("\ud83d\udccb E2E RUN SUMMARY");
  lines.push(sep);

  if (result.error) {
    lines.push(`\u274c ERROR: ${result.error.message}`);
  } else if (result.loomResult) {
    const r = result.loomResult;
    lines.push(`${r.success ? "\u2705 SUCCESS" : "\u274c FAILED"}`);
    lines.push(`   Sprints: ${r.sprints.length}`);
    for (const s of r.sprints) {
      lines.push(`   ${s.success ? "\u2705" : "\u274c"} ${s.sprintId} (${s.attempts} attempts, ${(s.durationMs / 1000).toFixed(1)}s)`);
    }
  }

  lines.push(`   Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
  lines.push(`   Task dir: ${result.taskDir}`);
  lines.push("");

  // 文件树
  lines.push("\ud83d\udcc1 OUTPUT FILES:");
  const relevantFiles = result.outputFiles.filter(
    (f) => !f.includes(".git/") && !f.includes("node_modules/")
  );
  for (const f of relevantFiles) {
    lines.push(`   ${f}`);
  }
  lines.push(sep);

  // 关键文件内容
  const keyFiles = [
    "project-plan.md",
    /sprint-\d+\/feature-spec\.md/,
    /sprint-\d+\/contract-negotiation\.md/,
    /sprint-\d+\/contract\.md/,
    /sprint-\d+\/eval-report\.md/,
    "final-report.md",
  ];

  for (const pattern of keyFiles) {
    const matches = relevantFiles.filter((f) =>
      typeof pattern === "string" ? f === pattern : pattern.test(f)
    );
    for (const match of matches) {
      const content = result.fileContents[match];
      if (content) {
        lines.push("");
        lines.push(`\ud83d\udcc4 ${match}`);
        lines.push("\u2500".repeat(40));
        lines.push(content.slice(0, 3000));
        if (content.length > 3000) lines.push(`... [truncated, ${content.length} chars total]`);
      }
    }
  }

  lines.push(sep);

  // workspace 中的代码文件
  const workspaceFiles = result.projectFiles;
  if (workspaceFiles.length > 0) {
    lines.push("");
    lines.push("\ud83d\udcbb GENERATED CODE:");
    for (const wf of workspaceFiles) {
      const content = result.fileContents[`project:${wf}`];
      if (content) {
        lines.push("");
        lines.push(`\ud83d\udcc4 ${wf}`);
        lines.push("\u2500".repeat(40));
        lines.push(content.slice(0, 2000));
        if (content.length > 2000) lines.push(`... [truncated]`);
      }
    }
  }

  lines.push(sep);
  const summary = lines.join("\n");
  console.log(summary);
  return summary;
}

// --- Helpers ---

function readFileContent(absPath: string, key: string, contents: Record<string, string>): void {
  try {
    const stat = fs.statSync(absPath);
    if (stat.size < 50 * 1024) {
      contents[key] = fs.readFileSync(absPath, "utf-8");
    } else {
      contents[key] = `[FILE TOO LARGE: ${stat.size} bytes]`;
    }
  } catch {
    contents[key] = "[READ ERROR]";
  }
}

function autoDiscoverTask(loomDir: string): string {
  const entries = fs.readdirSync(loomDir, { withFileTypes: true });
  const taskDir = entries.find(e => e.isDirectory());
  if (!taskDir) {
    throw new Error(`No task directory found in ${loomDir}`);
  }
  return taskDir.name;
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function collectFiles(dir: string, base: string = ""): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectFiles(path.join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}
