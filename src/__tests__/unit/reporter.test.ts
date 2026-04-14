import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { buildReporterPrompt, generateReport } from "../../reporter.js";
import type { LoomResult, LoomConfig } from "../../types.js";
import type { AgentRuntime } from "../../runtime.js";

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-report-"));
  tmpDirs.push(dir);
  return dir;
}

function makeConfig(taskDir: string, overrides?: Partial<LoomConfig>): LoomConfig {
  const runsDir = path.join(taskDir, "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  return {
    projectName: "test-project",
    taskName: "test-task",
    taskDir,
    projectRoot: "/project",
    runsDir,
    spec: "# Spec",
    roleFiles: { generator: "# Gen", evaluator: "# Eval" },
    designLanguage: "",

    verbose: false,
    ...overrides,
  };
}

function makeRuntime(response: string, exitCode = 0): AgentRuntime {
  return {
    run: async () => ({ response, exitCode }),
  } as unknown as AgentRuntime;
}

afterEach(() => {
  for (const d of tmpDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  tmpDirs = [];
});

describe("buildReporterPrompt", () => {
  it("includes ALL PASSED when all sprints succeed", () => {
    const dir = makeTmpDir();
    const result: LoomResult = {
      success: true,
      totalDurationMs: 5000,
      taskDir: dir,
      sprints: [
        { sprintId: "sprint-01", success: true, attempts: 1, durationMs: 2000 },
        { sprintId: "sprint-02", success: true, attempts: 2, durationMs: 3000 },
      ],
    };

    const prompt = buildReporterPrompt(result, makeConfig(dir));
    expect(prompt).toContain("ALL PASSED");
    expect(prompt).not.toContain("SOME FAILED");
  });

  it("includes SOME FAILED when some sprints fail", () => {
    const dir = makeTmpDir();
    const result: LoomResult = {
      success: false,
      totalDurationMs: 10000,
      taskDir: dir,
      sprints: [
        { sprintId: "sprint-01", success: true, attempts: 1, durationMs: 3000 },
        { sprintId: "sprint-02", success: false, attempts: 3, durationMs: 7000 },
      ],
    };

    const prompt = buildReporterPrompt(result, makeConfig(dir));
    expect(prompt).toContain("SOME FAILED");
    expect(prompt).toContain("sprint-02");
    expect(prompt).toContain("FAIL");
  });

  it("includes sprint summary with attempts and duration", () => {
    const dir = makeTmpDir();
    const result: LoomResult = {
      success: true,
      totalDurationMs: 2000,
      taskDir: dir,
      sprints: [
        { sprintId: "sprint-01", success: true, attempts: 1, durationMs: 2000 },
      ],
    };

    const prompt = buildReporterPrompt(result, makeConfig(dir));
    expect(prompt).toContain("sprint-01: PASS (1 attempts, 2.0s)");
  });

  it("embeds contract and eval report from disk", () => {
    const dir = makeTmpDir();
    const sprintDir = path.join(dir, "sprint-01");
    fs.mkdirSync(sprintDir, { recursive: true });
    fs.writeFileSync(path.join(sprintDir, "contract.md"), "test contract content");
    fs.writeFileSync(path.join(sprintDir, "eval-report.md"), "test eval content");

    const result: LoomResult = {
      success: true,
      totalDurationMs: 2000,
      taskDir: dir,
      sprints: [
        { sprintId: "sprint-01", success: true, attempts: 1, durationMs: 2000 },
      ],
    };

    const prompt = buildReporterPrompt(result, makeConfig(dir));
    expect(prompt).toContain("test contract content");
    expect(prompt).toContain("test eval content");
  });

  it("includes design language when provided", () => {
    const dir = makeTmpDir();
    const result: LoomResult = {
      success: true,
      totalDurationMs: 1000,
      taskDir: dir,
      sprints: [
        { sprintId: "sprint-01", success: true, attempts: 1, durationMs: 1000 },
      ],
    };

    const prompt = buildReporterPrompt(result, makeConfig(dir, { designLanguage: "Use Tailwind CSS" }));
    expect(prompt).toContain("## Design Language");
    expect(prompt).toContain("Use Tailwind CSS");
  });

  it("includes the spec from config", () => {
    const dir = makeTmpDir();
    const result: LoomResult = {
      success: true,
      totalDurationMs: 1000,
      taskDir: dir,
      sprints: [],
    };

    const prompt = buildReporterPrompt(result, makeConfig(dir, { spec: "Build a todo app" }));
    expect(prompt).toContain("Build a todo app");
  });
});

describe("generateReport", () => {
  it("writes final-report.md from agent response", async () => {
    const dir = makeTmpDir();
    const result: LoomResult = {
      success: true,
      totalDurationMs: 5000,
      taskDir: dir,
      sprints: [
        { sprintId: "sprint-01", success: true, attempts: 1, durationMs: 2000 },
      ],
    };
    const runtime = makeRuntime("# Handoff Report\nAll good!");

    await generateReport(result, makeConfig(dir), runtime);

    const md = fs.readFileSync(path.join(dir, "final-report.md"), "utf-8");
    expect(md).toContain("# Handoff Report");
    expect(md).toContain("All good!");
  });

  it("writes valid loom-result.json with correct structure", async () => {
    const dir = makeTmpDir();
    const result: LoomResult = {
      success: true,
      totalDurationMs: 5000,
      taskDir: dir,
      sprints: [
        { sprintId: "sprint-01", success: true, attempts: 1, durationMs: 2000 },
        { sprintId: "sprint-02", success: true, attempts: 2, durationMs: 3000 },
      ],
    };
    const runtime = makeRuntime("report content");

    await generateReport(result, makeConfig(dir), runtime);

    const raw = fs.readFileSync(path.join(dir, "loom-result.json"), "utf-8");
    const json = JSON.parse(raw);

    expect(json.success).toBe(true);
    expect(json.totalDurationMs).toBe(5000);
    expect(json.sprints).toHaveLength(2);
  });

  it("each sprint in JSON has id, success, attempts, durationMs", async () => {
    const dir = makeTmpDir();
    const result: LoomResult = {
      success: false,
      totalDurationMs: 7000,
      taskDir: dir,
      sprints: [
        { sprintId: "sprint-01", success: false, attempts: 3, durationMs: 7000 },
      ],
    };
    const runtime = makeRuntime("report");

    await generateReport(result, makeConfig(dir), runtime);

    const json = JSON.parse(
      fs.readFileSync(path.join(dir, "loom-result.json"), "utf-8")
    );
    const s = json.sprints[0];
    expect(s.id).toBe("sprint-01");
    expect(s.success).toBe(false);
    expect(s.attempts).toBe(3);
    expect(s.durationMs).toBe(7000);
  });

  it("throws when agent crashes with no response", async () => {
    const dir = makeTmpDir();
    const result: LoomResult = {
      success: true,
      totalDurationMs: 1000,
      taskDir: dir,
      sprints: [],
    };
    const runtime = makeRuntime("", 1);

    await expect(generateReport(result, makeConfig(dir), runtime)).rejects.toThrow(
      "Reporter agent crashed"
    );
  });

  it("skips report file when agent returns empty response with exit 0", async () => {
    const dir = makeTmpDir();
    const result: LoomResult = {
      success: true,
      totalDurationMs: 1000,
      taskDir: dir,
      sprints: [],
    };
    const runtime = makeRuntime("   ", 0);

    await generateReport(result, makeConfig(dir), runtime);

    // final-report.md should NOT be written
    expect(fs.existsSync(path.join(dir, "final-report.md"))).toBe(false);
    // but JSON should still be written
    expect(fs.existsSync(path.join(dir, "loom-result.json"))).toBe(true);
  });
});
