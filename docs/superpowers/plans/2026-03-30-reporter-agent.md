# Reporter Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the template-based `reporter.ts` with an LLM-driven reporter that generates actionable handoff reports for human reviewers and follow-up coding agents.

**Architecture:** `reporter.ts` becomes a prompt builder + runtime caller. `orchestrator.ts` passes `runtimes.evaluator` to `generateReport()`. `loom-result.json` stays deterministic (template). `final-report.md` becomes LLM-generated.

**Tech Stack:** TypeScript, Bun test runner, existing `AgentRuntime` from `runtime.ts`

**Spec:** `docs/superpowers/specs/2026-03-30-reporter-agent-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/reporter.ts` | Rewrite | `buildReporterPrompt()` constructs prompt with embedded artifacts; `generateReport()` calls runtime + writes files |
| `src/orchestrator.ts` | Modify (2 lines) | Pass `runtimes.evaluator` to `generateReport()`, set reporter log file |
| `src/__tests__/unit/reporter.test.ts` | Rewrite | Test prompt construction + JSON output; mock runtime for integration |

---

### Task 1: Rewrite `reporter.ts` — prompt builder + runtime caller

**Files:**
- Rewrite: `src/reporter.ts`

- [ ] **Step 1: Write `buildReporterPrompt` function**

This function reads all loom artifacts from disk and embeds them into a structured prompt. The prompt instructs the agent to explore the project codebase and produce a handoff report.

```typescript
import type { LoomConfig, LoomResult } from "./types.js";
import type { AgentRuntime } from "./runtime.js";
import { logger } from "./logger.js";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Read a file if it exists, return empty string otherwise.
 */
function readIfExists(filePath: string): string {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
}

/**
 * Build the reporter prompt with all loom artifacts embedded.
 * Exported for testing.
 */
export function buildReporterPrompt(
  result: LoomResult,
  config: LoomConfig,
): string {
  // Serialize sprint execution summary
  const sprintSummaryLines = result.sprints.map((s) => {
    const status = s.success ? "PASS" : "FAIL";
    const duration = (s.durationMs / 1000).toFixed(1);
    return `- ${s.sprintId}: ${status} (${s.attempts} attempts, ${duration}s)`;
  });
  const overallStatus = result.success ? "ALL PASSED" : "SOME FAILED";
  const totalTime = (result.totalDurationMs / 1000).toFixed(1);

  // Collect per-sprint artifacts (contracts + eval reports)
  const sprintSections: string[] = [];
  for (const s of result.sprints) {
    const sprintDir = path.join(config.taskDir, s.sprintId);
    const contract = readIfExists(path.join(sprintDir, "contract.md"));
    const evalReport = readIfExists(path.join(sprintDir, "eval-report.md"));
    const featureSpec = readIfExists(path.join(sprintDir, "feature-spec.md"));

    const parts = [`### ${s.sprintId} (${s.success ? "PASS" : "FAIL"})`];
    if (featureSpec) parts.push(`#### Feature Spec:\n${featureSpec}`);
    if (contract) parts.push(`#### Contract:\n${contract}`);
    if (evalReport) parts.push(`#### Evaluation Report:\n${evalReport}`);
    sprintSections.push(parts.join("\n\n"));
  }

  // Design language section (may be empty)
  const designSection = config.designLanguage
    ? `## Design Language\n\n${config.designLanguage}\n`
    : "";

  return `TASK: Generate a handoff report for a completed loom run.
This report serves TWO audiences:
1. Human reviewers who need to understand, verify, and take over the project
2. Follow-up coding agents (e.g., Claude Code CLI) who will execute setup commands and guide testing

## Overall Status

- Result: ${overallStatus}
- Total Time: ${totalTime}s
- Sprints: ${result.sprints.filter((s) => s.success).length}/${result.sprints.length} passed
${sprintSummaryLines.join("\n")}

## Project Spec (Original Intent)

${config.spec}

${designSection}
## Sprint Details

${sprintSections.join("\n\n---\n\n")}

## Instructions

Explore the project codebase to understand what was built. Read package.json, config files, .env.example, source code, seed scripts, etc. Then produce a handoff report with EXACTLY these sections:

### 1. Summary
- One sentence: what was built
- Overall status
- Key design decisions (why this approach, not alternatives)

### 2. Quick Start
- Dependency installation commands
- Environment variables needed (check .env.example, config files, etc.)
- Start command(s) (check package.json scripts, Makefile, docker-compose, etc.)
- Access URL/port
- ALL commands must be exact and copy-pasteable — a coding agent will execute them directly

### 3. Test Data & Accounts
- Seed scripts and how to run them (check for seed files, fixtures, migration scripts)
- Test accounts/credentials if any exist in seed data
- What data gets created
- If no seed data exists, state that clearly

### 4. Verification Checklist
- Convert the contract acceptance criteria into human/agent-executable verification steps
- Format as markdown checkboxes: - [ ] Step description
- Each step must say: what to do and what to expect as result
- Must be specific enough for a coding agent to execute programmatically
- Example: "- [ ] Run \`curl http://localhost:3000/api/health\` — expect JSON response with \`{"status":"ok"}\`"

### 5. What Changed
- List key files added/modified with one-line descriptions
- Group by feature/module, not alphabetically

### 6. Known Limitations
- Explicit exclusions from the spec
- Boundary cases or simplifications
- Failed sprints (if any) with reason summary

### 7. Sprint Execution Summary
- Markdown table with columns: Sprint | Status | Attempts | Duration

## Output Rules
- Write the report directly as your response — do NOT write to any files
- Do NOT create or modify any project files
- All commands in Quick Start and Test Data must be exact and runnable
- Verification steps must be concrete ("run this command, expect this output"), not vague ("test the feature")
- If you cannot determine a piece of information (e.g., no .env.example exists), say so explicitly rather than guessing

NOTE: You are running in HEADLESS mode with no interactive capabilities. Focus only on reading the codebase and producing the report.`;
}
```

- [ ] **Step 2: Write `generateReport` function**

```typescript
/**
 * Generate the final handoff report using an LLM agent, plus a deterministic JSON summary.
 */
export async function generateReport(
  result: LoomResult,
  config: LoomConfig,
  runtime: AgentRuntime,
): Promise<void> {
  // 1. LLM-generated handoff report
  const prompt = buildReporterPrompt(result, config);

  logger.info("Reporter", "生成交接报告...");
  const agentResult = await runtime.run({
    prompt,
    workDir: config.projectRoot,
  });

  if (agentResult.exitCode !== 0 && !agentResult.response.trim()) {
    logger.error("Reporter", `Agent 未响应（退出码: ${agentResult.exitCode}）`);
    throw new Error("Reporter agent crashed");
  }
  if (agentResult.exitCode !== 0) {
    logger.warn("Reporter", `Agent 退出码: ${agentResult.exitCode}`);
  }

  // Write LLM response as final-report.md
  const reportPath = path.join(config.taskDir, "final-report.md");
  if (agentResult.response.trim()) {
    fs.writeFileSync(reportPath, agentResult.response);
    logger.info("Reporter", `交接报告已写入: ${reportPath}`);
  } else {
    logger.warn("Reporter", "Agent 返回空响应，跳过报告写入");
  }

  // 2. Deterministic JSON summary (unchanged from original)
  const jsonSummary = {
    success: result.success,
    totalDurationMs: result.totalDurationMs,
    sprints: result.sprints.map((s) => ({
      id: s.sprintId,
      success: s.success,
      attempts: s.attempts,
      durationMs: s.durationMs,
    })),
    taskDir: result.taskDir,
  };
  const jsonPath = path.join(config.taskDir, "loom-result.json");
  fs.writeFileSync(jsonPath, JSON.stringify(jsonSummary, null, 2));
}
```

- [ ] **Step 3: Verify the full file compiles**

Run: `cd /Users/y/code/loom && npx tsc --noEmit`
Expected: No errors related to `reporter.ts`

- [ ] **Step 4: Commit**

```bash
git add src/reporter.ts
git commit -m "feat(reporter): rewrite as LLM-driven handoff report generator"
```

---

### Task 2: Update `orchestrator.ts` — pass runtime to reporter

**Files:**
- Modify: `src/orchestrator.ts:1-10` (imports)
- Modify: `src/orchestrator.ts:149-162` (report generation block)

- [ ] **Step 1: Update the import**

The import of `generateReport` is already present. No import change needed — `generateReport` still comes from `./reporter.js`. The signature change (added `runtime` param) is backward-compatible at the import level.

- [ ] **Step 2: Update the report generation block**

Find this block in `orchestrator.ts` (around line 149-162):

```typescript
  // 报告
  logger.banner("最终报告");
  const loomResult: LoomResult = {
    success: sprintResults.every((r) => r.success),
    sprints: sprintResults,
    totalDurationMs: Date.now() - startTime,
    taskDir: config.taskDir,
  };

  try {
    await generateReport(loomResult, config);
  } catch (err) {
    logger.error("Orchestrator", `报告生成失败：${err}`);
  }
```

Replace the `try` block with:

```typescript
  try {
    runtimes.evaluator.setLogFile(path.join(config.runsDir, "reporter.log"));
    await generateReport(loomResult, config, runtimes.evaluator);
  } catch (err) {
    logger.error("Orchestrator", `报告生成失败：${err}`);
  }
```

- [ ] **Step 3: Verify compilation**

Run: `cd /Users/y/code/loom && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/orchestrator.ts
git commit -m "feat(orchestrator): pass evaluator runtime to reporter for LLM-driven reports"
```

---

### Task 3: Rewrite `reporter.test.ts`

**Files:**
- Rewrite: `src/__tests__/unit/reporter.test.ts`

The old tests asserted template output (exact markdown strings). New tests cover:
1. `buildReporterPrompt` — verify all artifacts are embedded in the prompt
2. `generateReport` — verify runtime is called and files are written (mock runtime)
3. `loom-result.json` — verify deterministic JSON output (unchanged behavior)

- [ ] **Step 1: Write the new test file**

```typescript
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

function makeConfig(taskDir: string): LoomConfig {
  const runsDir = path.join(taskDir, "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  return {
    projectName: "test-project",
    taskName: "test-task",
    taskDir,
    projectRoot: "/project",
    runsDir,
    spec: "# Test Spec\nBuild a REST API",
    roleFiles: { generator: "# Gen", evaluator: "# Eval" },
    designLanguage: "Like Stripe SDK — clean interfaces",
    verbose: false,
  };
}

function makeResult(taskDir: string, success = true): LoomResult {
  return {
    success,
    totalDurationMs: 5000,
    taskDir,
    sprints: [
      { sprintId: "sprint-01", success: true, attempts: 1, durationMs: 2000 },
      { sprintId: "sprint-02", success, attempts: success ? 2 : 3, durationMs: 3000 },
    ],
  };
}

/** Create a mock AgentRuntime that returns a fixed response */
function mockRuntime(response: string): AgentRuntime {
  return {
    name: "mock",
    setLogFile: () => {},
    run: async () => ({ response, exitCode: 0 }),
  } as unknown as AgentRuntime;
}

afterEach(() => {
  for (const d of tmpDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  tmpDirs = [];
});

describe("buildReporterPrompt", () => {
  it("embeds spec content in prompt", () => {
    const dir = makeTmpDir();
    const config = makeConfig(dir);
    const result = makeResult(dir);

    const prompt = buildReporterPrompt(result, config);

    expect(prompt).toContain("# Test Spec");
    expect(prompt).toContain("Build a REST API");
  });

  it("embeds design language when present", () => {
    const dir = makeTmpDir();
    const config = makeConfig(dir);
    const result = makeResult(dir);

    const prompt = buildReporterPrompt(result, config);

    expect(prompt).toContain("Like Stripe SDK");
  });

  it("omits design language section when empty", () => {
    const dir = makeTmpDir();
    const config = makeConfig(dir);
    config.designLanguage = "";
    const result = makeResult(dir);

    const prompt = buildReporterPrompt(result, config);

    expect(prompt).not.toContain("## Design Language");
  });

  it("embeds sprint contracts and eval reports", () => {
    const dir = makeTmpDir();
    const sprintDir = path.join(dir, "sprint-01");
    fs.mkdirSync(sprintDir, { recursive: true });
    fs.writeFileSync(path.join(sprintDir, "contract.md"), "AC-01: health endpoint");
    fs.writeFileSync(path.join(sprintDir, "eval-report.md"), '{"passed": true}');

    const config = makeConfig(dir);
    const result = makeResult(dir);

    const prompt = buildReporterPrompt(result, config);

    expect(prompt).toContain("AC-01: health endpoint");
    expect(prompt).toContain('"passed": true');
  });

  it("includes sprint status summary", () => {
    const dir = makeTmpDir();
    const config = makeConfig(dir);
    const result = makeResult(dir, false);

    const prompt = buildReporterPrompt(result, config);

    expect(prompt).toContain("SOME FAILED");
    expect(prompt).toContain("sprint-01: PASS");
    expect(prompt).toContain("sprint-02: FAIL");
  });

  it("includes report structure instructions", () => {
    const dir = makeTmpDir();
    const config = makeConfig(dir);
    const result = makeResult(dir);

    const prompt = buildReporterPrompt(result, config);

    expect(prompt).toContain("Quick Start");
    expect(prompt).toContain("Verification Checklist");
    expect(prompt).toContain("Test Data & Accounts");
    expect(prompt).toContain("Known Limitations");
  });
});

describe("generateReport", () => {
  it("writes LLM response to final-report.md", async () => {
    const dir = makeTmpDir();
    const config = makeConfig(dir);
    const result = makeResult(dir);
    const runtime = mockRuntime("# Handoff Report\n\nThis is the report.");

    await generateReport(result, config, runtime);

    const md = fs.readFileSync(path.join(dir, "final-report.md"), "utf-8");
    expect(md).toContain("# Handoff Report");
    expect(md).toContain("This is the report.");
  });

  it("writes deterministic loom-result.json", async () => {
    const dir = makeTmpDir();
    const config = makeConfig(dir);
    const result = makeResult(dir);
    const runtime = mockRuntime("report content");

    await generateReport(result, config, runtime);

    const json = JSON.parse(
      fs.readFileSync(path.join(dir, "loom-result.json"), "utf-8"),
    );
    expect(json.success).toBe(true);
    expect(json.totalDurationMs).toBe(5000);
    expect(json.sprints).toHaveLength(2);
    expect(json.sprints[0].id).toBe("sprint-01");
    expect(json.sprints[0].success).toBe(true);
    expect(json.sprints[0].attempts).toBe(1);
    expect(json.sprints[0].durationMs).toBe(2000);
  });

  it("throws when runtime returns empty response with non-zero exit", async () => {
    const dir = makeTmpDir();
    const config = makeConfig(dir);
    const result = makeResult(dir);
    const runtime = {
      name: "mock",
      setLogFile: () => {},
      run: async () => ({ response: "", exitCode: 1 }),
    } as unknown as AgentRuntime;

    expect(generateReport(result, config, runtime)).rejects.toThrow(
      "Reporter agent crashed",
    );
  });

  it("skips report write when response is empty but exit code is 0", async () => {
    const dir = makeTmpDir();
    const config = makeConfig(dir);
    const result = makeResult(dir);
    const runtime = mockRuntime("   ");

    await generateReport(result, config, runtime);

    // final-report.md should not exist
    expect(fs.existsSync(path.join(dir, "final-report.md"))).toBe(false);
    // loom-result.json should still exist
    expect(fs.existsSync(path.join(dir, "loom-result.json"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd /Users/y/code/loom && bun test src/__tests__/unit/reporter.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/unit/reporter.test.ts
git commit -m "test(reporter): rewrite tests for LLM-driven reporter"
```

---

### Task 4: Update integration tests that reference reporter

**Files:**
- Check: `src/__tests__/integration/orchestrator-flow.test.ts`

- [ ] **Step 1: Check if integration tests call `generateReport` directly**

Read `src/__tests__/integration/orchestrator-flow.test.ts` and search for `generateReport` or `reporter` references. The integration test likely calls `runLoom()` which calls `generateReport()` internally — the signature change is internal, so the integration test may just need `runtimes` to be properly configured (which it already should be).

If integration tests mock or stub `generateReport`, update the mock to accept the third `runtime` parameter.

- [ ] **Step 2: Run all tests**

Run: `cd /Users/y/code/loom && bun test`
Expected: All tests pass

- [ ] **Step 3: Run type check**

Run: `cd /Users/y/code/loom && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit (if changes were needed)**

```bash
git add -A
git commit -m "fix: update integration tests for new reporter signature"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/y/code/loom && bun test`
Expected: All tests pass

- [ ] **Step 2: Run type check**

Run: `cd /Users/y/code/loom && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run build (if applicable)**

Run: `cd /Users/y/code/loom && bun run build 2>/dev/null || echo "no build script"`
Expected: Success or no build script

- [ ] **Step 4: Verify the prompt content manually**

Run a quick smoke test — import `buildReporterPrompt` and log its output for a sample input to eyeball the prompt structure:

```bash
cd /Users/y/code/loom && bun -e "
import { buildReporterPrompt } from './src/reporter.js';
const result = { success: true, totalDurationMs: 5000, taskDir: '/tmp/test', sprints: [{ sprintId: 'sprint-01', success: true, attempts: 1, durationMs: 2000 }] };
const config = { projectName: 'test', taskName: 'test', taskDir: '/tmp/test', projectRoot: '/tmp', runsDir: '/tmp/test/runs', spec: '# Build an API', roleFiles: { generator: '', evaluator: '' }, designLanguage: 'Clean and simple', verbose: false };
console.log(buildReporterPrompt(result, config).slice(0, 500));
"
```

Expected: Prompt starts with `TASK: Generate a handoff report` and contains spec content.
