/**
 * sprint-executor.ts — 单 Sprint 执行器
 *
 * 合约协商 → 实现（Generator）→ 验证（Evaluator）循环。
 * 失败记忆累积：跨 attempt 传递失败约束，防止 Generator 重复犯错。
 */

import type { LoomConfig, SprintResult } from "./types.js";
import { MAX_RETRIES } from "./types.js";
import type { AgentRuntime, Runtimes } from "./runtime.js";
import { getSprintRunsDir } from "./workspace.js";
import { negotiateContract } from "./negotiator.js";
import { loadContext, appendSprintContext } from "./context.js";
import { loadLessons } from "./lessons.js";
import type { FailureRecord } from "./context.js";
import { logger } from "./logger.js";
import { git, validateSprintId } from "./git.js";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// --- 失败记忆累积：跨尝试传递失败约束 ---


/** 从评估报告中提取通过条目（AC 名称） */
export function extractPassedItems(evalReport: string): string[] {
  return evalReport.split("\n")
    .filter(l => l.includes("✅ PASS"))
    .map(l => l.replace(/✅ PASS\s*[-—:]?\s*/, "").trim())
    .filter(l => l.length > 0)
    .map(l => l.slice(0, 200));
}

/** 从评估报告中提取失败条目（AC 名称 + 原因） */
export function extractFailedItems(evalReport: string): string[] {
  const items: string[] = [];
  const lines = evalReport.split("\n");

  let currentSection = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("## ") || line.startsWith("### ")) {
      currentSection = line.replace(/^#+\s*/, "").trim();
    }

    if (line.includes("❌ FAIL")) {
      const failDescription = line.replace(/❌ FAIL\s*[-—:]?\s*/, "").trim();
      const prefix =
        currentSection && !failDescription.includes(currentSection)
          ? `${currentSection}: `
          : "";

      // Grab up to 2 following context lines (Expected/Actual/Reason)
      const contextLines: string[] = [];
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const ctx = lines[j].trim();
        if (
          !ctx ||
          ctx.startsWith("✅") ||
          ctx.startsWith("❌") ||
          ctx.startsWith("##") ||
          ctx.startsWith("{")
        )
          break;
        contextLines.push(ctx);
      }

      let item = `${prefix}${failDescription}`;
      if (contextLines.length > 0) {
        item += " | " + contextLines.join(" | ");
      }

      items.push(item.slice(0, 300));
    }
  }

  return items;
}

/** 构建失败历史 section，注入到 retry prompt 中 */
export function buildFailureHistorySection(
  history: FailureRecord[],
): string {
  if (history.length === 0) return "";

  const sections = history.map((h) => {
    const items = h.failedItems.map((item) => `- ${item}`).join("\n");
    return `### Attempt ${h.attempt}:\n${items}`;
  });

  return `
## PREVIOUS FAILURE HISTORY (DO NOT REPEAT THESE MISTAKES)

${sections.join("\n\n")}

These exact failures have been tested and WILL fail again if repeated. You MUST take a different approach for each.
`;
}

// --- 机械化预检：从 Contract 提取 [PREFLIGHT] AC，在 Evaluator 前执行 ---

export interface PreflightAC {
  name: string;
  cmd: string;
  expected: string;
}

export interface PreflightResult {
  passed: boolean;
  results: { name: string; cmd: string; passed: boolean; detail: string }[];
}

/** 从 contract markdown 中解析 [PREFLIGHT] 标记的 AC */
export function parsePreflightACs(contract: string): PreflightAC[] {
  const acs: PreflightAC[] = [];
  const lines = contract.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("[PREFLIGHT]")) continue;

    const nameMatch = lines[i].match(/\*\*([^*]+)\*\*/);
    const name = nameMatch ? nameMatch[1].trim() : `PREFLIGHT-${acs.length + 1}`;

    // 找下一个 bash 代码块 → 命令
    let j = i + 1;
    while (j < lines.length && !lines[j].match(/^```(?:bash|sh)?$/)) j++;
    if (j >= lines.length) continue;
    j++; // 跳过 ```bash
    const cmdLines: string[] = [];
    while (j < lines.length && !lines[j].startsWith("```")) { cmdLines.push(lines[j]); j++; }
    const cmd = cmdLines.join("\n").trim();
    j++; // 跳过 closing ```

    // 找 "Expected" 后的代码块 → 预期输出
    while (j < lines.length && !lines[j].toLowerCase().startsWith("expected")) j++;
    let expected = "";
    if (j < lines.length) {
      j++; // 跳过 "Expected:" 行
      while (j < lines.length && !lines[j].startsWith("```")) j++;
      if (j < lines.length) {
        j++; // 跳过 opening ```
        const expLines: string[] = [];
        while (j < lines.length && !lines[j].startsWith("```")) { expLines.push(lines[j]); j++; }
        expected = expLines.join("\n").trim();
      }
    }

    if (cmd) acs.push({ name, cmd, expected });
  }
  return acs;
}

/** 执行预检 AC，比对实际输出与预期输出 */
export function runPreflight(acs: PreflightAC[], cwd: string): PreflightResult {
  const results: PreflightResult["results"] = [];

  for (const ac of acs) {
    try {
      const stdout = execSync(ac.cmd, { cwd, timeout: 60_000, stdio: "pipe", encoding: "utf-8" });
      const actual = stdout.trim();
      const passed = !ac.expected || actual.includes(ac.expected);
      results.push({ name: ac.name, cmd: ac.cmd, passed, detail: passed ? "" : `Expected: ${ac.expected}\nActual: ${actual}` });
      logger.debug("Preflight", `${passed ? "✅" : "❌"} ${ac.name}`);
    } catch (err: unknown) {
      const output = err instanceof Error
        ? ((err as { stderr?: string }).stderr ?? (err as { stdout?: string }).stdout ?? err.message)
        : String(err);
      results.push({ name: ac.name, cmd: ac.cmd, passed: false, detail: output.slice(0, 1000) });
      logger.debug("Preflight", `❌ ${ac.name}`);
    }
  }

  return { passed: results.every(r => r.passed), results };
}

/** 构建预检通过的 Evaluator 通知 section */
export function buildPreflightPassedSection(result: PreflightResult): string {
  if (result.results.length === 0) return "";
  const items = result.results.filter(r => r.passed).map(r => `- ${r.name}: \`${r.cmd}\` ✅`).join("\n");
  return `## Mechanical Pre-checks (already verified)\n\nThe following contract ACs tagged [PREFLIGHT] were run mechanically by the engine and passed. You do NOT need to re-run them — focus on remaining ACs, design review, and cross-file consistency.\n\n${items}`;
}

export async function executeSprint(
  runtimes: Runtimes,
  sprintId: string,
  config: LoomConfig,
): Promise<SprintResult> {
  const sprintDir = path.join(config.taskDir, sprintId);
  const projectRoot = config.projectRoot;
  const startTime = Date.now();
  const tagPrefix = `loom/${config.taskName}/${sprintId}`;

  validateSprintId(sprintId);

  logger.sprint(sprintId, `Starting Sprint`);

  // Git: 记录 Sprint 起始点
  try {
    git(projectRoot, ["tag", "-f", `${tagPrefix}/start`]);
    logger.debug("Git", `Tagged start point: ${tagPrefix}/start`);
  } catch {
    logger.warn("Git", "Cannot create git tag (might not be in a git repo)");
  }

  // 阶段 A：合约协商（在 sprintDir 中运行，不修改项目代码）
  const contractPath = path.join(sprintDir, "contract.md");
  if (fs.existsSync(contractPath)) {
    logger.info("Sprint", `Phase A: Contract already exists, skipping negotiation`);
  } else {
    logger.info("Sprint", `Phase A: Contract negotiation`);
    try {
      const negResult = await negotiateContract(runtimes, sprintDir, config);
      if (negResult.forcedApproval) {
        logger.warn("Sprint", `Contract force-approved after ${negResult.rounds} rounds`);
      }
    } catch (err) {
      logger.error("Sprint", `Negotiation failed: ${err}`);
      return { sprintId, success: false, attempts: 0, durationMs: Date.now() - startTime };
    }
  }

  // 阶段 B：实现 + 验证循环（在项目根目录运行）
  logger.info("Sprint", `Phase B: Implementation + Verification`);

  // 失败记忆：跨尝试累积失败约束，防止 Generator 重复犯错
  const failureHistory: FailureRecord[] = [];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    logger.attempt(attempt, MAX_RETRIES);

    // --- Generator：在项目根目录实现/修复 ---
    const isRetry = attempt > 1;
    try {
      await runGenerator(runtimes.generator, projectRoot, sprintDir, isRetry, config, failureHistory);
    } catch (err) {
      logger.error("Generator", `Error: ${err}`);
      continue;
    }

    // --- Preflight：从 Contract 提取 [PREFLIGHT] AC，机械化预检 ---
    let preflightResult: PreflightResult | undefined;
    const contractText = fs.existsSync(contractPath) ? fs.readFileSync(contractPath, "utf-8") : "";
    const preflightACs = parsePreflightACs(contractText);
    if (preflightACs.length > 0) {
      logger.info("Preflight", `Running ${preflightACs.length} [PREFLIGHT] ACs...`);
      preflightResult = runPreflight(preflightACs, projectRoot);
      if (!preflightResult.passed) {
        logger.info("Preflight", `Failed — skipping evaluator, feeding errors to generator`);
        const preflightFailures = preflightResult.results
          .filter(r => !r.passed)
          .map(r => `PREFLIGHT: ${r.name} — ${r.detail.split("\n")[0]?.slice(0, 200)}`);
        failureHistory.push({ attempt, failedItems: preflightFailures });
        continue;
      }
      logger.info("Preflight", `All ${preflightACs.length} [PREFLIGHT] ACs passed ✅`);
    }

    // --- Evaluator：在项目根目录验证 ---
    // Attempt 1: 完整评估。Attempt 2+: 只验证已知 failure（固定靶标，确保收敛）
    const previousFailures = [...new Set(failureHistory.flatMap(h => h.failedItems))];
    try {
      const verdict = await runEvaluator(runtimes.evaluator, projectRoot, sprintDir, attempt, config, attempt > 1 ? previousFailures : undefined, preflightResult);

      if (verdict.passed) {
        // 成功：commit 并打 tag
        try {
          git(projectRoot, ["add", "-A"]);
          git(projectRoot, ["commit", "-m", `loom: ${sprintId} complete`, "--allow-empty"]);
          git(projectRoot, ["tag", "-f", `${tagPrefix}/done`]);
          logger.debug("Git", `Sprint done, committed and tagged ${tagPrefix}/done`);
        } catch {
          logger.warn("Git", "Cannot auto-commit (please handle manually)");
        }
        logger.info("Sprint", `Sprint ${sprintId} passed on attempt ${attempt}`);
        // 跨 Sprint 知识传递：追加 sprint 摘要 + 失败约束到 context.md
        appendSprintContext(config.taskDir, sprintId, true, attempt, failureHistory);
        return { sprintId, success: true, attempts: attempt, durationMs: Date.now() - startTime };
      }

      // 累积失败记忆：提取本次失败约束，传递给下次 retry
      const reportPath = path.join(sprintDir, "eval-report.md");
      if (fs.existsSync(reportPath)) {
        const report = fs.readFileSync(reportPath, "utf-8");
        const failed = extractFailedItems(report);
        if (failed.length > 0) {
          failureHistory.push({ attempt, failedItems: failed });
          logger.debug("Sprint", `Accumulated ${failed.length} failure constraints -> attempt ${attempt + 1}`);
        }
      }

      logger.info("Sprint", `${sprintId} attempt ${attempt}: ${verdict.passCount}/${verdict.totalCount} passed`);
    } catch (err) {
      logger.error("Evaluator", `Error: ${err}`);
    }
  }

  // 所有尝试失败：保留最后一次 attempt 的代码供人工修复
  logger.error("Sprint", `Sprint ${sprintId} failed after ${MAX_RETRIES} attempts`);
  // 跨 Sprint 知识传递：即使失败，约束对后续 sprint 仍有价值
  appendSprintContext(config.taskDir, sprintId, false, MAX_RETRIES, failureHistory);
  try {
    git(projectRoot, ["add", "-A"]);
    git(projectRoot, ["commit", "-m", `loom: ${sprintId} partial (${MAX_RETRIES} attempts, not all ACs passed)`, "--allow-empty"]);
    git(projectRoot, ["tag", "-f", `${tagPrefix}/partial`]);
    logger.info("Git", `Preserved partial work as ${tagPrefix}/partial (code retained for manual fix)`);
  } catch {
    logger.warn("Git", "Cannot auto-commit partial work");
  }
  return { sprintId, success: false, attempts: MAX_RETRIES, durationMs: Date.now() - startTime };
}

// --- Generator：构建 prompt → 调用 agent → 实现代码 ---
// Prompt 结构：设计语言置顶（primacy effect）→ 任务指令 → 动态约束 → 角色定义

/** 无头约束块 — 所有 Generator prompt 共用 */
const HEADLESS_CONSTRAINTS = `CRITICAL HEADLESS CONSTRAINTS — You are a non-interactive subprocess:
- ONLY use: Read, Write, Edit, Glob, Grep, Bash tools
- NEVER use: TodoWrite, ToolSearch, Skill, Agent, AskUserQuestion, SendMessage, EnterPlanMode, or any interactive/planning tools
- NEVER search for or attempt to use tools not listed above
- Do NOT plan or organize tasks — just implement the code directly
- Git commit when done`;

/** Evaluator 最小无头约束 — 只禁交互工具，保留更高审查自由度 */
const EVALUATOR_HEADLESS_CONSTRAINTS = `NOTE: You are running in HEADLESS mode as a non-interactive subprocess.
- NEVER use: AskUserQuestion, SendMessage, EnterPlanMode, Agent, Skill, or any interactive/planning tools
- Do NOT write or modify project files — your job is to read, run verification commands, and report`;

/** 构建 prompt 尾部共用部分（context + lessons + 角色 + 合约） */
function buildPromptTail(contextSection: string, lessonsSection: string, roleInstructions: string, contractContent: string): string {
  return `${contextSection}${lessonsSection}
## Role & Coding Standards

${roleInstructions}

## Contract

${contractContent}`;
}

/** 检测评估报告中的失败是否全部为设计类（DESIGN:/CRITICAL: 前缀） */
export function isDesignOnlyFailure(evalReport: string): boolean {
  const failLines = evalReport.split("\n").filter(l => l.includes("❌ FAIL"));
  if (failLines.length === 0) return false;
  return failLines.every(l => /❌ FAIL\s*[-—:]?\s*(DESIGN:|CRITICAL:)/i.test(l));
}

async function runGenerator(
  runtime: AgentRuntime,
  projectRoot: string,
  sprintDir: string,
  isRetry: boolean,
  config: LoomConfig,
  failureHistory: FailureRecord[],
): Promise<void> {
  // 合约和评估报告在 ~/.loom 中，agent 在 projectRoot 运行
  // 直接将内容嵌入 prompt，避免跨目录文件引用
  const contractPath = path.join(sprintDir, "contract.md");
  const contractContent = fs.existsSync(contractPath) ? fs.readFileSync(contractPath, "utf-8") : "";
  const evalReportPath = path.join(sprintDir, "eval-report.md");
  const evalReportContent = isRetry && fs.existsSync(evalReportPath) ? fs.readFileSync(evalReportPath, "utf-8") : "";

  let prompt: string;

  // 设计语言放在 prompt 最前端（primacy effect — 最高注意力位置）
  const designSection = config.designLanguage
    ? `## Design Language\n\n${config.designLanguage}\n\n`
    : "";

  // 加载 context.md（跨 Sprint 知识传递）
  const context = loadContext(config.taskDir);
  const contextSection = context
    ? `\n## Accumulated Context\n\n${context}\n`
    : "";

  // 加载 lessons.md（跨任务项目级教训）
  const lessons = loadLessons(config.projectName);
  const lessonsSection = lessons
    ? `\n## Project Lessons (from previous tasks)\n\n${lessons}\n`
    : "";

  // 检测是否为设计专项重试（所有行为/架构 AC 通过，只有设计 FAIL）
  const designRetry = isRetry && config.designLanguage && isDesignOnlyFailure(evalReportContent);

  if (designRetry) {
    prompt = `${designSection}TASK: Your implementation is functionally correct -- all behavioral and architectural ACs passed. However, the design review found quality issues. Refactor to match the Design Language above.

## Design Review Feedback

${evalReportContent}

## Workflow
1. Read the Design Review Feedback -- understand each DESIGN: failure
2. Refactor the identified code to match the Design Language
3. Do NOT change any functional logic
4. Self-verify: re-run ALL ACs (behavioral + structural) to confirm no regressions
5. Git commit your changes

${HEADLESS_CONSTRAINTS}
${buildPromptTail(contextSection, lessonsSection, config.roleFiles.generator, contractContent)}`;
  } else if (isRetry) {
    const failureSection = buildFailureHistorySection(failureHistory);
    const passedItems = extractPassedItems(evalReportContent);
    const passedSection = passedItems.length > 0
      ? `## Previously Passing ACs (DO NOT BREAK)\n${passedItems.map(item => `- ${item}`).join("\n")}\nAfter fixing failures, re-run these to confirm they still pass.\n\n`
      : "";

    prompt = `${designSection}TASK: Fix failing acceptance criteria. The evaluation report is below.

${passedSection}## Evaluation Report

${evalReportContent}

${failureSection}
## Workflow
1. Read the failing ACs and understand why they failed
2. Trace each failure to the responsible code
3. Make targeted fixes (do NOT rewrite code that already passes)
4. Self-verify: run each failing AC's command, confirm it now passes
5. Re-run previously passing ACs to confirm no regressions
6. Git commit your changes

${HEADLESS_CONSTRAINTS}
${buildPromptTail(contextSection, lessonsSection, config.roleFiles.generator, contractContent)}`;
  } else {
    prompt = `${designSection}TASK: Implement ALL features listed in the contract below.

## Mandatory Requirements
- Only create or modify files listed in the contract's Deliverables section
- Do NOT delete existing files unless the contract explicitly requires removal
- No planning documents, notes, or extra files

## Workflow
1. Read the contract -- understand every AC and deliverable
2. Implement all deliverables listed in the contract
3. Self-verify: run each verification command, compare with expected output
4. Fix any mismatches found in step 3
5. Repeat steps 3-4 until all ACs pass
6. Self-review: re-read your code against the Design Language (if provided). If any code matches the ⚠️ (minimum acceptable) level rather than the ✅ (target) level, refactor it now -- before the evaluator sees it
7. Git commit your changes

${HEADLESS_CONSTRAINTS}
${buildPromptTail(contextSection, lessonsSection, config.roleFiles.generator, contractContent)}`;
  }

  const action = designRetry ? "Improving design quality" : isRetry ? "Fixing issues" : "Implementing features";
  logger.info("Generator", `${action}...`);

  const result = await runtime.run({ prompt, workDir: projectRoot });

  if (result.exitCode !== 0 && !result.response.trim()) {
    logger.error("Generator", `Agent not responding (exit code: ${result.exitCode})`);
    throw new Error("Agent crashed");
  }
  if (result.exitCode !== 0) {
    logger.warn("Generator", `Agent exit code: ${result.exitCode}`);
  }
  if (result.response) {
    logger.debug("Generator", result.response.slice(0, 200));
  }
  logger.info("Generator", `${action} done`);
}

// --- Evaluator：构建 prompt → 调用 agent → 解析报告 ---
// Prompt 优化：任务指令置顶 + 输出纪律（禁止 supplemental 标记）+ 环境笔记

async function runEvaluator(
  runtime: AgentRuntime,
  projectRoot: string,
  sprintDir: string,
  attempt: number,
  config: LoomConfig,
  previousFailures?: string[],
  preflightResult?: PreflightResult,
): Promise<{ passed: boolean; passCount: number; totalCount: number }> {
  logger.info("Evaluator", `Running evaluation (attempt ${attempt})...`);

  const reportPath = path.join(sprintDir, "eval-report.md");
  const contractPath = path.join(sprintDir, "contract.md");
  const contractContent = fs.existsSync(contractPath) ? fs.readFileSync(contractPath, "utf-8") : "";

  const featureSpecPath = path.join(sprintDir, "feature-spec.md");
  const featureSpecContent = fs.existsSync(featureSpecPath) ? fs.readFileSync(featureSpecPath, "utf-8") : "";
  const featureSpecSection = featureSpecContent
    ? `\n## Feature Specification (Original Requirements)\n\n${featureSpecContent}\n`
    : "";

  const context = loadContext(config.taskDir);
  const contextSection = context
    ? `\n## Accumulated Context\n\n${context}\n`
    : "";

  const lessons = loadLessons(config.projectName);
  const lessonsSection = lessons
    ? `\n## Project Lessons (from previous tasks)\n\n${lessons}\n`
    : "";

  const designSection = config.designLanguage
    ? `\n## Design Language (Calibration Reference)\n\n${config.designLanguage}\n`
    : "";

  const preflightSection = preflightResult
    ? buildPreflightPassedSection(preflightResult)
    : "";

  let prompt: string;

  if (attempt === 1) {
    // Attempt 1: 完整评估 — 合约 AC + 设计审查 + 关键扫描
    // 建立完整的 failure 清单，后续 attempt 只验证这个清单
    const designReviewInstructions = config.designLanguage
      ? `After running all ACs, review the actual source code against the **Design Language** above. The Design Language provides calibration examples at up to three levels: ❌ (unacceptable), ⚠️ (minimum acceptable), and ✅ (target quality). Use these as anchors for your judgment. Check:
- **Architecture**: Do module boundaries match the Design Language's ✅ target examples? Are dependencies flowing in the correct direction?
- **Abstraction quality**: Are abstractions at the right level as shown in the ✅ examples, not just the ⚠️ minimum?
- **Implementation craft**: Does the code match the ✅ target quality? Code at ⚠️ level should be noted for improvement.
- If source code review reveals design issues:
  - Code at ❌ level (unacceptable quality): mark as ❌ FAIL with prefix "DESIGN:" and include in verdict
  - Code at ⚠️ level (meets minimum but below target): mark as 📝 NOTE with prefix "DESIGN:" — on first attempt this is informational, but if the same ⚠️ pattern persists after a design retry, escalate to ❌ FAIL
  - All other observations: note as 📝 NOTE without ✅/❌ markers`
      : `After running all ACs, review the actual source code for design quality. Check architecture, abstraction quality, and implementation craft.
- Silent design violations: mark as ❌ FAIL with prefix "DESIGN:" and include in verdict
- All other observations: note as 📝 NOTE without ✅/❌ markers`;

    prompt = `TASK: This is attempt #1 (initial evaluation). Perform a COMPLETE evaluation.

Run the verification commands specified in the contract and report the results.
${designSection}${preflightSection ? `\n${preflightSection}\n` : ""}
## Contract

${contractContent}
${featureSpecSection}
## Output Format

### Part 1: Contract AC Verification
- Run each AC's verification command and report ✅ PASS or ❌ FAIL
- For each ❌ FAIL, include: the command run, expected vs actual output, and a clear reason

### Part 2: Source Code Review
${designReviewInstructions}

### Part 2b: Cross-File Consistency Check
Before completing the design review, perform these specific cross-file checks on the deliverable source files:
- **Shared type location**: If the same interface/type is imported by 3+ files, is it defined in a dedicated types file (not embedded in one implementation file)? If not, mark as ❌ FAIL with prefix "DESIGN:"
- **Pattern consistency**: Are error handling, numeric conversion, and input validation patterns consistent across all files of the same kind (e.g., all route files, all command files)?
- **Import hygiene**: Do all files that need the same type import it from the same source?

### Part 3: Critical Observation Scan
- Beyond contract ACs and code review, perform a critical-observation scan against the feature specification above:
  - If you discover issues where the implementation silently violates the specification's intent despite passing all ACs, mark as ❌ FAIL with prefix "CRITICAL:" and include in verdict

### Verdict
- End the report with a JSON verdict on the LAST line:
  {"passed": true/false, "pass_count": N, "total_count": N}
- Output the report directly as your response — do NOT write to any files

${EVALUATOR_HEADLESS_CONSTRAINTS}
${contextSection}${lessonsSection}
## Role & QA Standards

${config.roleFiles.evaluator}`;
  } else {
    // Attempt 2+: 收敛评估 — 只验证之前失败的项是否修复 + 合约 AC 不回退
    // 不做新的开放式审查，确保靶标固定、收敛
    const failureChecklist = (previousFailures ?? []).map((f, i) => `${i + 1}. ${f}`).join("\n");
    const hasDesignFailures = (previousFailures ?? []).some(f => f.startsWith("DESIGN:"));

    prompt = `TASK: This is attempt #${attempt} (regression check). The generator has attempted to fix previous failures.

Your job is NARROW and SPECIFIC:
1. Re-run ALL contract AC verification commands (check for regressions)
2. Re-verify ONLY the previously failed items listed below (check if fixed)
3. Do NOT perform new open-ended source code review or critical observation scan
4. Do NOT report new issues that were not in the previous failure list
${hasDesignFailures ? designSection : ""}${preflightSection ? `\n${preflightSection}\n` : ""}
## Previously Failed Items (verify these are fixed)

${failureChecklist}

## Contract

${contractContent}

## Output Format

### Part 1: Contract AC Verification
- Run each AC's verification command and report ✅ PASS or ❌ FAIL

### Part 2: Previous Failure Re-check
- For each previously failed item above, verify if it is now fixed
- Report ✅ PASS or ❌ FAIL for each

### Verdict
- End the report with a JSON verdict on the LAST line:
  {"passed": true/false, "pass_count": N, "total_count": N}
- Output the report directly as your response — do NOT write to any files

${EVALUATOR_HEADLESS_CONSTRAINTS}
${contextSection}${lessonsSection}
## Role & QA Standards

${config.roleFiles.evaluator}`;
  }

  const result = await runtime.run({ prompt, workDir: projectRoot });

  if (result.exitCode !== 0 && !result.response.trim()) {
    throw new Error(`Evaluator agent crashed (exit code: ${result.exitCode})`);
  }
  if (result.exitCode !== 0) {
    logger.warn("Evaluator", `Agent exit code: ${result.exitCode}`);
  }

  const response = result.response;

  if (response.trim()) {
    fs.writeFileSync(reportPath, response);
  }

  // 归档评估报告到 .runs/ 目录（运行时产物）
  if (fs.existsSync(reportPath)) {
    const sprintRunDir = getSprintRunsDir(config.runsDir, path.basename(sprintDir));
    fs.copyFileSync(reportPath, path.join(sprintRunDir, `eval-report-attempt-${attempt}.md`));
  }

  const verdict = parseEvalReport(response);

  logger.info(
    "Evaluator",
    `Result: ${verdict.passed ? "PASS ✅" : "FAIL ❌"} (${verdict.passCount}/${verdict.totalCount})`
  );

  return verdict;
}

// --- 评估报告解析（导出供单元测试使用）---

/** 纯解析逻辑 — 无文件 I/O
 *
 * 优先级：JSON verdict（结构化、权威） > ✅/❌ 标记（非结构化、回退）
 * 评估器被指示在响应末尾输出 JSON verdict，这是最可靠的信号源。
 * 标记计数仅在无 JSON 时作为回退，因为标记可能包含 supplemental checks 等噪声。
 */
export function parseEvalReport(
  content: string,
): { passed: boolean; passCount: number; totalCount: number } {
  // 优先：JSON verdict（评估器的权威声明）
  try {
    if (content.match(/\{[^}]*"passed"\s*:/)) {
      const jsonStr = content.slice(
        content.lastIndexOf("{"),
        content.lastIndexOf("}") + 1,
      );
      const parsed = JSON.parse(jsonStr);
      return {
        passed: parsed.passed ?? false,
        passCount: parsed.pass_count ?? 0,
        totalCount: parsed.total_count ?? 0,
      };
    }
  } catch {
    // JSON 解析失败，回退到标记计数
  }

  // 回退：✅/❌ 标记计数（可能包含 supplemental checks 噪声）
  const passCount = (content.match(/✅ PASS/g) ?? []).length;
  const failCount = (content.match(/❌ FAIL/g) ?? []).length;
  const totalCount = passCount + failCount;

  if (totalCount > 0) {
    return { passed: failCount === 0, passCount, totalCount };
  }

  logger.warn("Evaluator", "Cannot parse verdict, defaulting to failure");
  return { passed: false, passCount: 0, totalCount: 0 };
}
