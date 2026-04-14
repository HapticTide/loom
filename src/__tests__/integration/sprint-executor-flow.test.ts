import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import type { Runtimes } from "../../runtime.js";
import type { LoomConfig } from "../../types.js";
import { MAX_RETRIES } from "../../types.js";
import { executeSprint } from "../../sprint-executor.js";
import { createMockRuntime } from "./mock-runtime.js";
import { logger } from "../../logger.js";
import { deriveProjectName } from "../../state.js";

describe("sprint executor flow (mock runtime)", () => {
  let tmpDir: string;
  let loomHome: string;
  let homedirSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    loomHome = fs.mkdtempSync(path.join(os.tmpdir(), "loom-home-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(loomHome);

    // Reset singleton logger state from other test files
    logger.setLogFile(null);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-sprint-flow-"));

    const projectName = deriveProjectName(tmpDir);
    const taskDir = path.join(loomHome, ".loom", "projects", projectName, "test-task");
    const sprintDir = path.join(taskDir, "sprint-01");
    fs.mkdirSync(sprintDir, { recursive: true });
    fs.writeFileSync(
      path.join(sprintDir, "feature-spec.md"),
      "# Sprint 01: Test Feature\n\nImplement a test feature.",
    );

    // Initialize git repo at project root
    execSync(
      "git init && git config user.email 'test@test.com' && git config user.name 'Test' && git add -A && git commit -m 'init' --allow-empty",
      { cwd: tmpDir, stdio: "ignore" },
    );
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

  function makeConfig(): LoomConfig {
    const projectName = deriveProjectName(tmpDir);
    const taskDir = path.join(loomHome, ".loom", "projects", projectName, "test-task");
    const runsDir = path.join(taskDir, "runs");
    fs.mkdirSync(runsDir, { recursive: true });
    return {
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
  }

  const PASS_RESPONSE =
    "## AC-01\n✅ PASS\n## AC-02\n✅ PASS\n" +
    '{"passed":true,"pass_count":2,"total_count":2}';

  const FAIL_RESPONSE =
    "## AC-01\n✅ PASS\n## AC-02\n❌ FAIL\n" +
    '{"passed":false,"pass_count":1,"total_count":2}';

  // Call sequence per sprint:
  //   generator: negotiation proposal, then one "implement/fix" per attempt
  //   evaluator: negotiation APPROVED, then one eval verdict per attempt

  it("first attempt pass: success=true, attempts=1", async () => {
    const runtimes = {
      generator: createMockRuntime([
        { response: "# Contract proposal", exitCode: 0 }, // negotiation
        { response: "implemented code", exitCode: 0 },    // attempt 1
      ]),
      evaluator: createMockRuntime([
        { response: "## Verdict: APPROVED", exitCode: 0 }, // negotiation
        { response: PASS_RESPONSE, exitCode: 0 },          // attempt 1
      ]),
    } as unknown as Runtimes;

    const result = await executeSprint(runtimes, "sprint-01", makeConfig());

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.sprintId).toBe("sprint-01");
    expect(result.durationMs).toBeGreaterThan(0);
  }, 10000);

  it("retry on eval fail: passes on second attempt", async () => {
    const runtimes = {
      generator: createMockRuntime([
        { response: "# Contract proposal", exitCode: 0 }, // negotiation
        { response: "first implementation", exitCode: 0 }, // attempt 1
        { response: "fixed implementation", exitCode: 0 }, // attempt 2
      ]),
      evaluator: createMockRuntime([
        { response: "## Verdict: APPROVED", exitCode: 0 }, // negotiation
        { response: FAIL_RESPONSE, exitCode: 0 },          // attempt 1: fail
        { response: PASS_RESPONSE, exitCode: 0 },          // attempt 2: pass
      ]),
    } as unknown as Runtimes;

    const result = await executeSprint(runtimes, "sprint-01", makeConfig());

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  }, 10000);

  it("all retries exhausted: success=false, attempts=MAX_RETRIES", async () => {
    // Need: 1 negotiation + MAX_RETRIES implementation calls per role
    const genResponses = [
      { response: "# Contract proposal", exitCode: 0 },
      ...Array.from({ length: MAX_RETRIES }, (_, i) => ({
        response: `implementation attempt ${i + 1}`,
        exitCode: 0,
      })),
    ];
    const evalResponses = [
      { response: "## Verdict: APPROVED", exitCode: 0 },
      ...Array.from({ length: MAX_RETRIES }, () => ({
        response: FAIL_RESPONSE,
        exitCode: 0,
      })),
    ];

    const runtimes = {
      generator: createMockRuntime(genResponses),
      evaluator: createMockRuntime(evalResponses),
    } as unknown as Runtimes;

    const result = await executeSprint(runtimes, "sprint-01", makeConfig());

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(MAX_RETRIES);
  }, 10000);
});
