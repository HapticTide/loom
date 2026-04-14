/**
 * reporter.ts — 最终报告生成
 *
 * 收集所有 Sprint 产物（合约、评估报告），调用 LLM 生成可交付的手工报告，
 * 同时输出确定性 JSON 摘要。
 */

import type { LoomConfig, LoomResult } from "./types.js";
import type { AgentRuntime } from "./runtime.js";
import { logger } from "./logger.js";
import * as fs from "node:fs";
import * as path from "node:path";

/** 读取文件内容，不存在时返回空字符串 */
function readIfExists(filePath: string): string {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
}

/** 构建 Reporter 的 prompt（嵌入所有 loom 产物）— 导出供测试使用 */
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

/** 生成最终交付报告（LLM 生成 markdown + 确定性 JSON 摘要） */
export async function generateReport(
  result: LoomResult,
  config: LoomConfig,
  runtime: AgentRuntime,
): Promise<void> {
  // 1. LLM-generated handoff report
  const prompt = buildReporterPrompt(result, config);

  logger.info("Reporter", "Generating handoff report...");
  const agentResult = await runtime.run({
    prompt,
    workDir: config.projectRoot,
  });

  if (agentResult.exitCode !== 0 && !agentResult.response.trim()) {
    logger.error("Reporter", `Agent not responding (exit code: ${agentResult.exitCode})`);
    throw new Error("Reporter agent crashed");
  }
  if (agentResult.exitCode !== 0) {
    logger.warn("Reporter", `Agent exit code: ${agentResult.exitCode}`);
  }

  // Write LLM response as final-report.md
  const reportPath = path.join(config.taskDir, "final-report.md");
  if (agentResult.response.trim()) {
    fs.writeFileSync(reportPath, agentResult.response);
    logger.info("Reporter", `Handoff report written: ${reportPath}`);
  } else {
    logger.warn("Reporter", "Agent returned empty response, skipping report");
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
