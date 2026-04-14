import { describe, it, expect, afterEach, beforeEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadWorkspace, LoomWorkspaceError } from "../../workspace.js";
import { getTaskDir } from "../../state.js";

let tmpDirs: string[] = [];
let homedirSpy: ReturnType<typeof spyOn>;

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-test-"));
  tmpDirs.push(dir);
  return dir;
}

/** Setup task files in ~/.loom for the given project root */
function setupTask(projectRoot: string, taskName: string): void {
  const loomHome = path.join(os.homedir(), ".loom");
  const { deriveProjectName } = require("../../state.js");
  const projectName = deriveProjectName(projectRoot);
  const taskDir = path.join(loomHome, "projects", projectName, taskName);
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, "spec.md"), "# Spec");
  fs.writeFileSync(path.join(taskDir, "generator.md"), "# Generator");
  fs.writeFileSync(path.join(taskDir, "evaluator.md"), "# Evaluator");
}

beforeEach(() => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "loom-home-"));
  tmpDirs.push(fakeHome);
  homedirSpy = spyOn(os, "homedir").mockReturnValue(fakeHome);
});

afterEach(() => {
  homedirSpy.mockRestore();
  for (const d of tmpDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  tmpDirs = [];
});

describe("loadWorkspace", () => {
  it("loads a valid workspace with all files", async () => {
    const projectRoot = makeTmpDir();
    setupTask(projectRoot, "mytask");
    const ws = await loadWorkspace(projectRoot, "mytask");

    expect(ws.projectRoot).toBe(projectRoot);
    expect(ws.taskName).toBe("mytask");
    expect(ws.spec).toBe("# Spec");
    expect(ws.roleFiles.generator).toBe("# Generator");
    expect(ws.roleFiles.evaluator).toBe("# Evaluator");
    expect(ws.projectName).toBeTruthy();
  });

  it("creates runs/ directory on load", async () => {
    const projectRoot = makeTmpDir();
    setupTask(projectRoot, "mytask");
    const ws = await loadWorkspace(projectRoot, "mytask");

    expect(fs.existsSync(ws.runsDir)).toBe(true);
    expect(ws.runsDir).toContain("runs");
  });

  it("throws LoomWorkspaceError when spec.md is missing", async () => {
    const projectRoot = makeTmpDir();
    setupTask(projectRoot, "mytask");
    // Remove spec.md
    const { deriveProjectName } = require("../../state.js");
    const taskDir = getTaskDir(deriveProjectName(projectRoot), "mytask");
    fs.unlinkSync(path.join(taskDir, "spec.md"));

    await expect(loadWorkspace(projectRoot, "mytask")).rejects.toThrow(LoomWorkspaceError);
  });

  it("throws LoomWorkspaceError mentioning generator.md when missing", async () => {
    const projectRoot = makeTmpDir();
    setupTask(projectRoot, "mytask");
    const { deriveProjectName } = require("../../state.js");
    const taskDir = getTaskDir(deriveProjectName(projectRoot), "mytask");
    fs.unlinkSync(path.join(taskDir, "generator.md"));

    await expect(loadWorkspace(projectRoot, "mytask")).rejects.toThrow(/generator\.md/);
  });

  it("throws LoomWorkspaceError mentioning evaluator.md when missing", async () => {
    const projectRoot = makeTmpDir();
    setupTask(projectRoot, "mytask");
    const { deriveProjectName } = require("../../state.js");
    const taskDir = getTaskDir(deriveProjectName(projectRoot), "mytask");
    fs.unlinkSync(path.join(taskDir, "evaluator.md"));

    await expect(loadWorkspace(projectRoot, "mytask")).rejects.toThrow(/evaluator\.md/);
  });

  it("lists both missing role files", async () => {
    const projectRoot = makeTmpDir();
    setupTask(projectRoot, "mytask");
    const { deriveProjectName } = require("../../state.js");
    const taskDir = getTaskDir(deriveProjectName(projectRoot), "mytask");
    fs.unlinkSync(path.join(taskDir, "generator.md"));
    fs.unlinkSync(path.join(taskDir, "evaluator.md"));

    try {
      await loadWorkspace(projectRoot, "mytask");
      expect(true).toBe(false); // should not reach
    } catch (err: any) {
      expect(err).toBeInstanceOf(LoomWorkspaceError);
      expect(err.message).toContain("generator.md");
      expect(err.message).toContain("evaluator.md");
    }
  });

  it("throws LoomWorkspaceError for non-existent project root", async () => {
    await expect(loadWorkspace("/nonexistent/path/xyz", "test")).rejects.toThrow(LoomWorkspaceError);
  });
});
