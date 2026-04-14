/**
 * E2E Test: Hello World CLI
 *
 * 黑盒测试 — 验证 Loom 完整管道：Negotiation → Generator → Evaluator
 *
 * 运行时：codex（--quiet --full-auto）
 * Fixture：预创建的 sprint-01/feature-spec.md
 *
 * 验证策略（对齐 Anthropic harness best-practices）：
 * 1. 管道不崩溃 — Loom 返回结果对象
 * 2. 协商产物 — contract-negotiation.md + contract.md 存在且非空
 * 3. 评估产物 — eval-report.md 存在且含 ✅/❌ 标记
 * 4. 项目代码 — projectRoot 下生成了代码文件
 * 5. 完整摘要 — 打印供人工/LLM 审查  
 *
 * 运行方式：
 *   bun test e2e/hello-world.test.ts
 */

import { describe, test, expect, afterAll } from "bun:test";
import { runE2E, cleanupE2E, printSummary, type E2ERunResult } from "./e2e-utils.js";

// E2E 超时：15 分钟（协商 + 实现 + 验证，codex 可能较慢）
const E2E_TIMEOUT = 15 * 60 * 1000;

const E2E_RUNTIME = process.env.LOOM_E2E_RUNTIME ?? "codex";

let result: E2ERunResult | null = null;

describe(`E2E: Hello World CLI (${E2E_RUNTIME})`, () => {
  afterAll(() => {
    if (result) {
      // 打印完整摘要供审查
      printSummary(result);
      cleanupE2E(result);
    }
  });

  test(
    "full pipeline: negotiate → generate → evaluate",
    async () => {
      result = await runE2E("hello-world");

      // Loom 不能崩溃
      if (result.error) {
        console.error("❌ Loom crashed:", result.error.message);
      }
      expect(result.loomResult).not.toBeNull();
    },
    E2E_TIMEOUT,
  );

  test("negotiation artifacts exist", () => {
    if (!result?.loomResult) return;

    const files = result.outputFiles;

    // contract-negotiation.md — 协商历史
    const negotiation = files.find((f) => f.endsWith("contract-negotiation.md"));
    expect(negotiation).toBeDefined();
    if (negotiation) {
      const content = result.fileContents[negotiation];
      expect(content).toContain("# Contract Negotiation");
      expect(content).toContain("Proposal");
    }

    // contract.md — 最终合约
    const contract = files.find((f) => f.endsWith("contract.md"));
    expect(contract).toBeDefined();
    if (contract) {
      const content = result.fileContents[contract];
      // 合约应包含验收标准
      expect(content.length).toBeGreaterThan(50);
    }
  });

  test("evaluation report exists with verdict markers", () => {
    if (!result?.loomResult) return;

    const report = result.outputFiles.find((f) => f.match(/eval-report(-attempt-\d+)?\.md$/));
    expect(report).toBeDefined();
    if (report) {
      const content = result.fileContents[report];
      // 评估报告应含 PASS 或 FAIL 标记
      expect(content).toMatch(/[✅❌]/);
    }
  });

  test("project root contains generated code", () => {
    if (!result?.loomResult) return;

    // Generator 在 projectRoot 中创建代码文件（不在 .loom/ 或 .git/ 下）
    expect(result.projectFiles.length).toBeGreaterThan(0);
  });

  test("final report generated", () => {
    if (!result?.loomResult) return;

    const hasReport = result.outputFiles.some((f) => f === "final-report.md");
    expect(hasReport).toBe(true);

    const hasJson = result.outputFiles.some((f) => f === "loom-result.json");
    expect(hasJson).toBe(true);
  });
});
