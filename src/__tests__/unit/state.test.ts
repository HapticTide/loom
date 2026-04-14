import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  deriveProjectName,
  getLoomHome,
  getProjectDir,
  getTaskDir,
  getRunsDir,
  ensureLoomGitignore,
  loadTaskState,
  saveTaskState,
  createTaskState,
  updateSprintState,
  loadIndex,
  syncIndex,
  resolveLoomWorkspace,
} from "../../state.js";

let tmpDirs: string[] = [];
let homedirSpy: ReturnType<typeof spyOn>;

function makeTmpDir(prefix = "loom-state-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

beforeEach(() => {
  const fakeHome = makeTmpDir("loom-home-");
  homedirSpy = spyOn(os, "homedir").mockReturnValue(fakeHome);
});

afterEach(() => {
  homedirSpy.mockRestore();
  for (const d of tmpDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  tmpDirs = [];
});

describe("deriveProjectName", () => {
  it("returns stable name for same path", () => {
    const n1 = deriveProjectName("/tmp/myproject");
    const n2 = deriveProjectName("/tmp/myproject");
    expect(n1).toBe(n2);
  });

  it("returns same name for same dir name in different paths", () => {
    const n1 = deriveProjectName("/tmp/project-a");
    const n2 = deriveProjectName("/home/user/project-a");
    expect(n1).toBe(n2);
  });

  it("is the directory basename", () => {
    const name = deriveProjectName("/tmp/my-cool-project");
    expect(name).toBe("my-cool-project");
  });

  it("sanitizes special characters in dir name", () => {
    const name = deriveProjectName("/tmp/My Project (v2)");
    expect(name).not.toContain(" ");
    expect(name).not.toContain("(");
    expect(name).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("path resolvers", () => {
  it("getProjectDir returns correct path", () => {
    const dir = getProjectDir("test-id");
    expect(dir).toBe(path.join(getLoomHome(), "projects", "test-id"));
  });

  it("getTaskDir returns correct path", () => {
    const dir = getTaskDir("test-id", "my-task");
    expect(dir).toBe(path.join(getLoomHome(), "projects", "test-id", "my-task"));
  });

  it("getRunsDir returns correct path", () => {
    const dir = getRunsDir("test-id", "my-task");
    expect(dir).toBe(path.join(getLoomHome(), "projects", "test-id", "my-task", "runs"));
  });
});

describe("ensureLoomGitignore", () => {
  it("creates .gitignore with .loom entry", () => {
    const dir = makeTmpDir();
    ensureLoomGitignore(dir);
    const content = fs.readFileSync(path.join(dir, ".gitignore"), "utf-8");
    expect(content).toContain(".loom");
  });

  it("appends to existing .gitignore", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n");
    ensureLoomGitignore(dir);
    const content = fs.readFileSync(path.join(dir, ".gitignore"), "utf-8");
    expect(content).toContain("node_modules/");
    expect(content).toContain(".loom");
  });

  it("does not duplicate entry", () => {
    const dir = makeTmpDir();
    ensureLoomGitignore(dir);
    ensureLoomGitignore(dir);
    const content = fs.readFileSync(path.join(dir, ".gitignore"), "utf-8");
    const matches = content.match(/\.loom/g);
    expect(matches?.length).toBe(1);
  });
});

describe("task state", () => {
  it("loadTaskState returns null for nonexistent", () => {
    expect(loadTaskState("no-exist", "no-task")).toBeNull();
  });

  it("createTaskState + saveTaskState + loadTaskState round-trip", () => {
    const projectRoot = makeTmpDir();
    const projectName = deriveProjectName(projectRoot);
    // Ensure directory exists
    fs.mkdirSync(getTaskDir(projectName, "test"), { recursive: true });

    const state = createTaskState(projectName, projectRoot, "test");
    expect(state.status).toBe("created");
    expect(state.taskName).toBe("test");

    saveTaskState(state);
    const loaded = loadTaskState(projectName, "test");
    expect(loaded).not.toBeNull();
    expect(loaded!.status).toBe("created");
    expect(loaded!.projectRoot).toBe(projectRoot);
  });

  it("updateSprintState adds sprint entries", () => {
    const state = createTaskState("test-id", "/tmp/test", "task");
    updateSprintState(state, "sprint-01", { status: "negotiating" });
    expect(state.sprints["sprint-01"].status).toBe("negotiating");
    expect(state.sprints["sprint-01"].attempts).toBe(0);

    updateSprintState(state, "sprint-01", { status: "passed", attempts: 2 });
    expect(state.sprints["sprint-01"].status).toBe("passed");
    expect(state.sprints["sprint-01"].attempts).toBe(2);
  });
});

describe("global index", () => {
  it("loadIndex returns empty on fresh home", () => {
    const index = loadIndex();
    expect(index.projects).toEqual({});
  });

  it("syncIndex creates index entry", () => {
    const state = createTaskState("proj-id", "/tmp/test", "task");
    state.status = "executing";
    updateSprintState(state, "sprint-01", { status: "passed", attempts: 1, durationMs: 1000 });

    syncIndex(state);
    const index = loadIndex();
    expect(index.projects["proj-id"]).toBeDefined();
    expect(index.projects["proj-id"].path).toBe("/tmp/test");
    expect(index.projects["proj-id"].tasks["task"].status).toBe("executing");
    expect(index.projects["proj-id"].tasks["task"].completed).toBe(1);
  });
});

describe("resolveLoomWorkspace", () => {
  it("creates all directories and returns paths", () => {
    const projectRoot = makeTmpDir();
    const result = resolveLoomWorkspace(projectRoot, "my-task");

    expect(result.projectName).toBeTruthy();
    expect(fs.existsSync(result.loomTaskDir)).toBe(true);
    expect(fs.existsSync(result.loomRunsDir)).toBe(true);

    // State initialized
    const state = loadTaskState(result.projectName, "my-task");
    expect(state).not.toBeNull();
    expect(state!.status).toBe("created");
  });

  it("is idempotent", () => {
    const projectRoot = makeTmpDir();
    const r1 = resolveLoomWorkspace(projectRoot, "task");
    const r2 = resolveLoomWorkspace(projectRoot, "task");
    expect(r1.projectName).toBe(r2.projectName);
    expect(r1.loomTaskDir).toBe(r2.loomTaskDir);
  });
});
