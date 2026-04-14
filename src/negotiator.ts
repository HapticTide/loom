import type { LoomConfig, NegotiationResult } from "./types.js";
import { MAX_NEGOTIATION_ROUNDS } from "./types.js";
import type { Runtimes } from "./runtime.js";
import { getSprintRunsDir } from "./workspace.js";
import { loadContext } from "./context.js";
import { logger } from "./logger.js";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * 合约协商：生成器↔评估器多轮协商，
 * 将 feature-spec 细化为可验证的合约。
 *
 * 优化策略：
 *   - 历史窗口化：prompt 只含最新提案+反馈，避免 O(n²) 膨胀
 *   - 增量持久化：每轮写入 draft + 追加 negotiation log
 */

interface HistoryEntry {
  header: string;
  content: string;
}

export async function negotiateContract(
  runtimes: Runtimes,
  sprintDir: string,
  config: LoomConfig,
): Promise<NegotiationResult> {
  const featureSpecPath = path.join(sprintDir, "feature-spec.md");
  const negotiationPath = path.join(sprintDir, "contract-negotiation.md");
  const contractPath = path.join(sprintDir, "contract.md");

  // contract-draft 是运行时中间产物，放入 .runs/
  const sprintRunDir = getSprintRunsDir(config.runsDir, path.basename(sprintDir));
  const draftPath = path.join(sprintRunDir, "contract-draft.md");

  const roleGenerator = config.roleFiles.generator;
  const roleEvaluator = config.roleFiles.evaluator;
  const featureSpec = fs.readFileSync(featureSpecPath, "utf-8");
  const context = loadContext(config.taskDir);

  const history: HistoryEntry[] = [];

  // 初始化协商日志（每轮增量追加）
  initNegotiationLog(negotiationPath, featureSpec);

  let round = 1;
  let lastProposal = "";

  while (true) {
    // --- 生成器提出/修订合约提案 ---
    logger.info("Negotiation", `Round ${round}: Generator proposing contract...`);

    const genPrompt = buildGeneratorPrompt(roleGenerator, featureSpec, history, round, context, config.designLanguage);
    const genResult = await runtimes.generator.run({ prompt: genPrompt, workDir: sprintDir });
    lastProposal = genResult.response;

    if (!lastProposal.trim()) {
      throw new Error("Generator returned empty contract proposal");
    }

    logger.debug("Negotiation:Gen", lastProposal.slice(0, 200));
    history.push({ header: `Round ${round}: Proposal`, content: lastProposal });

    // 增量持久化：覆写 draft，追加 negotiation log
    fs.writeFileSync(draftPath, lastProposal);
    appendNegotiationEntry(negotiationPath, `Round ${round}: Proposal`, lastProposal);

    // --- 评估器审查提案 ---
    logger.info("Negotiation", `Round ${round}: Evaluator reviewing proposal...`);

    const evalPrompt = buildEvaluatorPrompt(roleEvaluator, featureSpec, history, round, context, config.designLanguage);
    const evalResult = await runtimes.evaluator.run({ prompt: evalPrompt, workDir: sprintDir });
    const reviewContent = evalResult.response;

    if (!reviewContent.trim()) {
      throw new Error("Evaluator returned empty review");
    }

    logger.debug("Negotiation:Eval", reviewContent.slice(0, 200));
    history.push({ header: `Round ${round}: Review`, content: reviewContent });

    appendNegotiationEntry(negotiationPath, `Round ${round}: Review`, reviewContent);

    const verdict = parseVerdict(reviewContent);

    if (verdict === "APPROVED") {
      fs.renameSync(draftPath, contractPath);
      logger.info("Negotiation", `Contract approved after ${round} rounds ✅`);
      return { approved: true, rounds: round, forcedApproval: false };
    }

    logger.info("Negotiation", `Round ${round}: Revision -- Evaluator requested changes`);

    if (round >= MAX_NEGOTIATION_ROUNDS) {
      logger.warn("Negotiation", `No agreement after ${round} rounds. Using last proposal as contract.`);
      fs.renameSync(draftPath, contractPath);
      return { approved: true, rounds: round, forcedApproval: true };
    }

    round++;
  }
}

// --- 增量文件操作 ---

export function initNegotiationLog(filePath: string, featureSpec: string): void {
  fs.writeFileSync(filePath, `# Contract Negotiation\n\n## Feature Spec\n\n${featureSpec}\n\n---\n`);
}

export function appendNegotiationEntry(filePath: string, header: string, content: string): void {
  fs.appendFileSync(filePath, `\n## ${header}\n\n${content.trim()}\n\n---\n`);
}

export function saveNegotiationHistory(
  filePath: string,
  featureSpec: string,
  history: HistoryEntry[]
): void {
  const lines = [`# Contract Negotiation\n\n## Feature Spec\n\n${featureSpec}\n\n---\n`];
  for (const entry of history) {
    lines.push(`\n## ${entry.header}\n\n${entry.content.trim()}\n\n---\n`);
  }
  fs.writeFileSync(filePath, lines.join(""));
}

// --- 提示词构建（窗口化 + 任务指令置顶）---

export function buildGeneratorPrompt(
  roleInstructions: string,
  featureSpec: string,
  history: HistoryEntry[],
  round: number,
  context?: string,
  designLanguage?: string,
): string {
  const contractFormat = `Your ENTIRE response must be the contract proposal. Include:
- A clear title and goal
- Specific acceptance criteria (AC-01, AC-02, etc.), each with:
  - A description of what to verify
  - The exact shell command to run for verification
  - The expected output (see rules per category below)
- THREE categories of verification:
  1. BEHAVIORAL ACs [PREFLIGHT]: Verify WHAT the code does using the project's own toolchain commands.
     - ONLY use: build commands (make build, tsc --noEmit), test runners (bun test, npm test, make test), lint commands (eslint, swiftlint)
     - Leave "Expected output" EMPTY — the engine judges by exit code only (0 = PASS, non-zero = FAIL)
     - Include quality gate concerns as behavioral tests:
       * Boundary safety: test ACs must cover invalid/missing/edge-case inputs (NaN, "0", empty string)
       * Test coverage: at least one error-path test per feature, not just happy-path
       * Test authenticity: verify tests pass via exit code, not by grepping test file content
     - Do NOT write ad-hoc shell scripts (grep pipelines, awk, sed, command substitution, redirections) as verification commands
     - The engine runs [PREFLIGHT] ACs mechanically before invoking the evaluator. If any fail, the generator retries immediately without an evaluator round.
  2. STRUCTURAL ACs [PREFLIGHT]: Verify HOW the code is organized using SINGLE, SIMPLE commands.
     - ONLY allowed commands: grep (with -r, -l, -L, -c flags), find, wc -l
     - MUST be a single command — NO pipes (|), redirections (>, 2>&1), command substitution ($(...)), shell arithmetic, or multi-command chains (&&, ||, ;)
     - Leave "Expected output" EMPTY — the engine judges by exit code only
     - Use for: dependency direction, file existence, import patterns
     - Examples of ALLOWED commands:
       * grep -rL "import.*from.*controllers" src/models/  (exit 0 if no model imports controllers)
       * find src/types -name "*.ts" -type f  (exit 0 if types directory has .ts files)
     - Examples of FORBIDDEN commands:
       * grep -c 'pattern' file | awk '{if ($1 > 0) exit 1}'  (pipe)
       * for f in ...; do grep ... done  (loop/shell script)
       * count=$(grep -c ...); echo $count  (command substitution)
     - Structural ACs catch the most likely honest mistakes. Do NOT over-engineer checks.
  3. DESIGN ACs: Verify code quality — the evaluator reads source files and judges against criteria. Each Design AC specifies:
     - Which files to review
     - Which design criterion to evaluate (referencing the Design Language if provided)
     - A concrete pass/fail threshold
     - Design ACs also cover cross-cutting concerns:
       * Shared type hygiene: types imported by 3+ files must be in dedicated types files
       * Module boundary integrity: no circular dependencies, correct abstraction layers
       * Pattern consistency across files of the same kind
     Example: "DESIGN-AC-01: Error handling style — Review src/services/*.ts — Errors must be domain-specific types, not generic strings."
     If no Design Language is provided, omit design-quality Design ACs (but keep structural-concern Design ACs).
- Verification commands must NOT depend on: specific ports, network connectivity, OS-specific tools, or environment-specific paths. They should work in any clean checkout.
- A list of deliverables (files to be created/modified)

SPEC COVERAGE (required section at end of contract):
- Before the deliverables list, include a "## Spec Coverage" section
- List every CONCRETE feature from the feature spec: CLI commands/flags, API endpoints/return values, UI controls/screens, configuration parameters, specific thresholds
- For each, write one of:
  - "→ AC-XX" (mapped to a specific acceptance criterion)
  - "→ OUT-OF-SCOPE: [reason]" (excluded with brief justification)
- Do NOT list: background prose, user stories, architecture descriptions, design philosophy — these provide context but are not individually verifiable features
- Example:
  - "Light/dark theme toggle → AC-12" (concrete UI control)
  - "--refresh flag for cache bypass → AC-08" (concrete CLI flag)
  - "TTL 24 hours for cache → AC-09" (concrete threshold)

IMPORTANT:
- [PREFLIGHT] ACs (BEHAVIORAL and STRUCTURAL) rely on exit code — do NOT include expected stdout for matching.
- Only include deliverables that directly implement features in the feature spec — no planning documents, no notes.
- Do NOT write to any files. Output the contract proposal directly as your response.`;

  const designSection = designLanguage
    ? `\n## Design Language\n\n${designLanguage}\n`
    : "";

  const contextSection = context
    ? `\n## Accumulated Context\n\n${context}\n`
    : "";

  if (round === 1) {
    return `TASK: You are entering the CONTRACT NEGOTIATION phase.

This is Round 1. Based on the feature spec below, propose a detailed contract.
${designSection}
## Feature Spec

${featureSpec}

${contractFormat}
${contextSection}
## Role & Coding Standards

${roleInstructions}`;
  }

  // Round N > 1：最新提案 + 最新反馈 + 原始 Feature Spec（确保 spec 覆盖率）
  const lastProposal = getLastEntry(history, "Proposal");
  const lastReview = getLastEntry(history, "Review");

  return `TASK: You are entering the CONTRACT NEGOTIATION phase.

This is Round ${round}. The evaluator has requested revisions. Address ALL concerns below in your revised proposal.
${designSection}
## Feature Spec (Original Requirements — do NOT drop features from this spec)

${featureSpec}

## Your Previous Proposal

${lastProposal}

## Evaluator Feedback

${lastReview}

${contractFormat}
${contextSection}
## Role & Coding Standards

${roleInstructions}`;
}

export function buildEvaluatorPrompt(
  roleInstructions: string,
  featureSpec: string,
  history: HistoryEntry[],
  round?: number,
  context?: string,
  designLanguage?: string,
): string {
  const latestProposal = getLastEntry(history, "Proposal");
  const reviewSummary = buildReviewSummary(history);

  const summarySection = reviewSummary
    ? `\n## Previous Rounds Summary\n\n${reviewSummary}\n`
    : "";

  const designSection = designLanguage
    ? `\n## Design Language\n\n${designLanguage}\n`
    : "";

  const designReviewCriteria = designLanguage
    ? `- DESIGN VERIFICATION: Does the proposal include Design ACs that verify code quality against the Design Language? Each feature with non-trivial implementation should have at least one Design AC specifying files to review and the design criterion to evaluate. If no Design ACs are present despite a Design Language being provided, REVISE.
`
    : "";

  const designReviseCriteria = designLanguage
    ? `- Missing Design ACs: a Design Language is provided but no Design ACs verify code quality against it
`
    : "";

  const contextSection = context
    ? `\n## Accumulated Context\n\n${context}\n`
    : "";

  const focusedReviewNote = (round && round >= 3)
    ? `\nFOCUSED REVIEW (Round ${round}): This proposal has undergone multiple revision cycles. Your PRIMARY task is to verify whether the revision reasons from the previous round have been addressed. If all previous issues are resolved and no newly added or modified ACs contain errors, APPROVE the contract. Do NOT re-evaluate unchanged ACs that were not flagged in the previous round.\n`
    : "";

  return `TASK: You are reviewing a contract proposal from the generator.
${designSection}
## Feature Spec

${featureSpec}
${summarySection}
## Latest Proposal${round ? ` (Round ${round})` : ""}

${latestProposal}
${focusedReviewNote}
Focus on the LATEST proposal. Review criteria (ONLY these — do not invent additional criteria):
- SPEC COVERAGE AUDIT: The proposal must include a "Spec Coverage" section. Verify it by:
  1. Read the feature spec and identify features that have CONCRETE deliverables: CLI commands/flags, API endpoints/return values, UI controls/screens, configuration parameters, specific numeric thresholds (e.g., "TTL 24 hours")
  2. Check that each concrete feature appears in Spec Coverage with "→ AC-XX" or "→ OUT-OF-SCOPE: [reason]"
  3. For OUT-OF-SCOPE items: accept if the reason is reasonable (e.g., deferred to later sprint, requires infrastructure not yet available). Reject only if the feature is clearly core to the spec's stated goal
  4. Do NOT require mapping for: background/motivation prose, user stories (these describe WHY, the AC covers WHAT), architecture descriptions, design philosophy
  5. If a CONCRETE feature (CLI flag, API return value, UI element, config param) is missing from Spec Coverage entirely: REVISE
- Are the deliverables complete for the stated features?
- If this is a revision, were ALL previous feedback items addressed?
- PREFLIGHT COMMAND SAFETY: Every [PREFLIGHT] AC (BEHAVIORAL and STRUCTURAL) must follow these rules:
  - BEHAVIORAL ACs must use project toolchain commands only (build/test/lint) — no ad-hoc shell scripts
  - STRUCTURAL ACs must be a SINGLE command (grep/find/wc) — no pipes, redirections, command substitution, loops, or multi-command chains
  - [PREFLIGHT] ACs must have EMPTY expected output (engine uses exit code only)
  - If any [PREFLIGHT] AC uses pipes (|), redirections (>, 2>&1), $(...), or chains (&&, ||, ;): REVISE
- QUALITY GATE COVERAGE: The contract must include behavioral test ACs covering:
  - Boundary safety (invalid input tests for numeric endpoints/commands)
  - Error-path test coverage (not just happy-path)
  - Test authenticity (tests verified by exit code, not by grepping test file content)
- STRUCTURAL COVERAGE: Each deliverable should have at least one structural AC (single grep/find command) or a DESIGN AC that specifies the files and architectural criterion to verify. Structural ACs catch honest mistakes — do NOT evaluate against adversarial implementations.
${designReviewCriteria}
REVISE only for execution-blocking issues:
- A [PREFLIGHT] AC that uses forbidden shell constructs (pipes, redirections, command substitution, loops)
- A [PREFLIGHT] AC with non-empty expected output (must rely on exit code only)
- Missing Spec Coverage section, or a concrete feature (CLI flag, API return value, UI element, config param) from the spec not listed in it
- A spec feature mapped to an AC that doesn't actually test it
- Missing quality gate coverage (no boundary/error-path test ACs)
- A deliverable with no structural AC and no DESIGN AC covering its architecture
${designReviseCriteria}
Do NOT request revisions for:
- Additional edge cases beyond what the feature spec requires
- Stylistic preferences on how ACs are written
- Suggestions for "nice to have" tests
- Theoretical adversarial implementations: structural ACs catch honest mistakes, not adversarial exploits

Your ENTIRE response must be the review. End with a verdict:

## Verdict: APPROVED
(if the contract is ready for implementation)

OR

## Verdict: REVISE
### Revision Reasons
- [specific execution-blocking issue]

Do NOT write to any files. Output the review directly as your response.
${contextSection}
## Role & QA Standards

${roleInstructions}`;
}

// --- 辅助函数 ---

export function getLastEntry(history: HistoryEntry[], type: "Proposal" | "Review"): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].header.includes(type)) {
      return history[i].content;
    }
  }
  return "";
}

export function extractAcIds(text: string): string[] {
  const matches = text.match(/`?(AC-\d+|ARCH-\d+|DESIGN-\d+)`?/g);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.replace(/`/g, "")))];
}

export function buildReviewSummary(history: HistoryEntry[]): string {
  const reviews = history.filter(h => h.header.includes("Review"));
  if (reviews.length === 0) return "";

  const rounds = reviews.map(r => {
    const roundMatch = r.header.match(/Round (\d+)/);
    const roundNum = roundMatch ? parseInt(roundMatch[1]) : 0;
    const verdict = parseVerdict(r.content);
    const reasons = extractRevisionReasons(r.content);
    const acIds = reasons.flatMap(extractAcIds);
    return { roundNum, verdict, reasons, acIds };
  });

  const latest = rounds[rounds.length - 1];

  // Determine resolved AC IDs: appeared in earlier rounds but not in the latest
  const resolvedAcIds = new Set<string>();
  for (let i = 0; i < rounds.length - 1; i++) {
    for (const acId of rounds[i].acIds) {
      if (!latest.acIds.includes(acId)) {
        resolvedAcIds.add(acId);
      }
    }
  }

  const lines: string[] = [];
  lines.push(`${reviews.length} rounds completed.`);

  if (resolvedAcIds.size > 0) {
    lines.push(`\nResolved in prior rounds: ${[...resolvedAcIds].join(", ")}`);
  }

  lines.push(`\nRound-by-round:`);
  for (const r of rounds) {
    if (r.verdict === "REVISE") {
      const reasonText = r.reasons.length > 0 ? r.reasons.join("; ") : "No specific reasons listed";
      lines.push(`- Round ${r.roundNum}: REVISE -- ${reasonText}`);
    } else {
      lines.push(`- Round ${r.roundNum}: APPROVED`);
    }
  }

  if (latest.verdict === "REVISE" && latest.reasons.length > 0) {
    lines.push(`\nLatest open issues (Round ${latest.roundNum}):`);
    for (const reason of latest.reasons) {
      lines.push(`- ${reason}`);
    }
    lines.push(`\nFOCUS: Verify whether these Round ${latest.roundNum} issues are now addressed.`);
  }

  return lines.join("\n");
}

export function extractRevisionReasons(reviewContent: string): string[] {
  const match = reviewContent.match(/###\s*Revision Reasons\s*\n([\s\S]*?)(?=\n##|\n$|$)/i);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map(line => line.replace(/^[-*]\s*/, "").trim())
    .filter(line => line.length > 0);
}

// --- 评判解析 ---

export function parseVerdict(reviewContent: string): "APPROVED" | "REVISE" {
  const approvedMatch = reviewContent.match(/##\s*Verdict:\s*APPROVED/i);
  const reviseMatch = reviewContent.match(/##\s*Verdict:\s*REVISE/i);

  if (approvedMatch && !reviseMatch) return "APPROVED";
  if (reviseMatch && !approvedMatch) return "REVISE";

  if (approvedMatch && reviseMatch) {
    const approvedIdx = reviewContent.lastIndexOf(approvedMatch[0]);
    const reviseIdx = reviewContent.lastIndexOf(reviseMatch[0]);
    return approvedIdx > reviseIdx ? "APPROVED" : "REVISE";
  }

  logger.warn("Negotiation", "Cannot parse verdict from review, defaulting to REVISE");
  return "REVISE";
}
