import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import type { Runtimes } from "../../runtime.js";
import type { LoomConfig } from "../../types.js";
import { runLoom } from "../../orchestrator.js";
import { createMockRuntime } from "./mock-runtime.js";
import { deriveProjectName } from "../../state.js";

describe("orchestrator flow (mock runtime)", () => {
  let tmpDir: string;
  let loomHome: string;
  let homedirSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    loomHome = fs.mkdtempSync(path.join(os.tmpdir(), "loom-home-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(loomHome);
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
    if (loomHome && fs.existsSync(loomHome)) {
      fs.rmSync(loomHome, { recursive: true });
    }
  });

  function initGitRepo(dir: string) {
    execSync(
      "git init && git config user.email 'test@test.com' && git config user.name 'Test' && git add -A && git commit -m 'init' --allow-empty",
      { cwd: dir, stdio: "ignore" },
    );
  }

  /** Set up tmpDir with a task directory containing the given sprint IDs */
  function setupProject(sprintIds: string[]): { taskDir: string; config: LoomConfig } {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-orch-flow-"));
    const projectName = deriveProjectName(tmpDir);
    const taskDir = path.join(loomHome, ".loom", "projects", projectName, "test-task");
    fs.mkdirSync(taskDir, { recursive: true });

    for (const id of sprintIds) {
      const sprintDir = path.join(taskDir, id);
      fs.mkdirSync(sprintDir, { recursive: true });
      fs.writeFileSync(
        path.join(sprintDir, "feature-spec.md"),
        `# ${id}: Test Feature\n\nImplement feature for ${id}.`,
      );
    }

    initGitRepo(tmpDir);

    const runsDir = path.join(taskDir, "runs");
    fs.mkdirSync(runsDir, { recursive: true });

    const config: LoomConfig = {
      projectName,
      taskName: "test-task",
      taskDir,
      projectRoot: tmpDir,
      runsDir,
      spec: "Test spec",
      roleFiles: {
        generator: "You are a generator.",
        evaluator: "You are an evaluator.",
      },
      designLanguage: "",

      verbose: false,
    };

    return { taskDir, config };
  }

  const PASS_EVAL =
    "## AC-01\n✅ PASS\n## AC-02\n✅ PASS\n" +
    '{"passed":true,"pass_count":2,"total_count":2}';

  // Per sprint (single-round negotiation + first-attempt pass):
  //   generator calls: proposal, implementation
  //   evaluator calls: APPROVED, PASS

  it("multi-sprint execution: 2 sprints both pass", async () => {
    const { config } = setupProject(["sprint-01", "sprint-02"]);

    const runtimes = {
      generator: createMockRuntime([
        // Sprint 1
        { response: "# Contract for sprint-01", exitCode: 0 },
        { response: "sprint-01 implementation", exitCode: 0 },
        // Sprint 2
        { response: "# Contract for sprint-02", exitCode: 0 },
        { response: "sprint-02 implementation", exitCode: 0 },
      ]),
      evaluator: createMockRuntime([
        // Sprint 1
        { response: "## Verdict: APPROVED", exitCode: 0 },
        { response: PASS_EVAL, exitCode: 0 },
        // Sprint 2
        { response: "## Verdict: APPROVED", exitCode: 0 },
        { response: PASS_EVAL, exitCode: 0 },
      ]),
    } as unknown as Runtimes;

    const result = await runLoom(config, runtimes);

    expect(result.success).toBe(true);
    expect(result.sprints).toHaveLength(2);
    expect(result.sprints[0].success).toBe(true);
    expect(result.sprints[1].success).toBe(true);
    expect(result.taskDir).toBe(config.taskDir);
    expect(result.totalDurationMs).toBeGreaterThan(0);
  }, 10000);

  it("no sprints found: returns failure with empty sprints array", async () => {
    // Create task dir with no sprint-XX subdirectories
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-orch-empty-"));
    const projectName = deriveProjectName(tmpDir);
    const taskDir = path.join(loomHome, ".loom", "projects", projectName, "test-task");
    fs.mkdirSync(taskDir, { recursive: true });
    initGitRepo(tmpDir);

    const runsDir = path.join(taskDir, "runs");
    fs.mkdirSync(runsDir, { recursive: true });

    const config: LoomConfig = {
      projectName,
      taskName: "test-task",
      taskDir,
      projectRoot: tmpDir,
      runsDir,
      spec: "Test spec",
      roleFiles: {
        generator: "You are a generator.",
        evaluator: "You are an evaluator.",
      },
      designLanguage: "",

      verbose: false,
    };

    const runtimes = {
      generator: createMockRuntime([]),
      evaluator: createMockRuntime([]),
    } as unknown as Runtimes;

    const result = await runLoom(config, runtimes);

    expect(result.success).toBe(false);
    expect(result.sprints).toHaveLength(0);
  }, 10000);

  it("generator.log and evaluator.log are created in .runs/ dir", async () => {
    const { taskDir, config } = setupProject(["sprint-01"]);

    const runtimes = {
      generator: createMockRuntime([
        { response: "# Contract", exitCode: 0 },
        { response: "implementation", exitCode: 0 },
      ]),
      evaluator: createMockRuntime([
        { response: "## Verdict: APPROVED", exitCode: 0 },
        { response: PASS_EVAL, exitCode: 0 },
      ]),
    } as unknown as Runtimes;

    await runLoom(config, runtimes);

    expect(fs.existsSync(path.join(config.runsDir, "generator.log"))).toBe(true);
    expect(fs.existsSync(path.join(config.runsDir, "evaluator.log"))).toBe(true);
  }, 10000);

  it("loom-result.json and final-report.md are created", async () => {
    const { taskDir, config } = setupProject(["sprint-01"]);

    const runtimes = {
      generator: createMockRuntime([
        { response: "# Contract", exitCode: 0 },
        { response: "implementation", exitCode: 0 },
      ]),
      evaluator: createMockRuntime([
        { response: "## Verdict: APPROVED", exitCode: 0 },
        { response: PASS_EVAL, exitCode: 0 },
        // Reporter call (evaluator runtime is reused for report generation)
        { response: "# Handoff Report\n\n✅ ALL PASSED", exitCode: 0 },
      ]),
    } as unknown as Runtimes;

    await runLoom(config, runtimes);

    // loom-result.json
    const resultJsonPath = path.join(taskDir, "loom-result.json");
    expect(fs.existsSync(resultJsonPath)).toBe(true);
    const resultJson = JSON.parse(fs.readFileSync(resultJsonPath, "utf-8"));
    expect(resultJson.success).toBe(true);
    expect(resultJson.sprints).toHaveLength(1);

    // final-report.md
    const reportPath = path.join(taskDir, "final-report.md");
    expect(fs.existsSync(reportPath)).toBe(true);
    const report = fs.readFileSync(reportPath, "utf-8");
    expect(report).toContain("Handoff Report");
  }, 10000);

  it("sprint with existing done tag is skipped (T4)", async () => {
    const { config } = setupProject(["sprint-01", "sprint-02"]);

    // Create the done tag for sprint-01 to simulate a previously completed sprint
    execSync(`git tag loom/${config.taskName}/sprint-01/done`, { cwd: config.projectRoot, stdio: "ignore" });

    // Only sprint-02 should run, so we only need mock responses for sprint-02
    const runtimes = {
      generator: createMockRuntime([
        // Sprint 2 only
        { response: "# Contract for sprint-02", exitCode: 0 },
        { response: "sprint-02 implementation", exitCode: 0 },
      ]),
      evaluator: createMockRuntime([
        // Sprint 2 only
        { response: "## Verdict: APPROVED", exitCode: 0 },
        { response: PASS_EVAL, exitCode: 0 },
      ]),
    } as unknown as Runtimes;

    const result = await runLoom(config, runtimes);

    expect(result.success).toBe(true);
    expect(result.sprints).toHaveLength(2);

    // sprint-01 was skipped
    expect(result.sprints[0].sprintId).toBe("sprint-01");
    expect(result.sprints[0].success).toBe(true);
    expect(result.sprints[0].attempts).toBe(0);
    expect(result.sprints[0].durationMs).toBe(0);

    // sprint-02 ran normally
    expect(result.sprints[1].sprintId).toBe("sprint-02");
    expect(result.sprints[1].success).toBe(true);
    expect(result.sprints[1].attempts).toBeGreaterThan(0);
  }, 10000);
});
