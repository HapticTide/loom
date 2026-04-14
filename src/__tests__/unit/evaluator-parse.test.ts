import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { parseEvalReport, extractFailedItems, extractPassedItems, buildFailureHistorySection, isDesignOnlyFailure } from "../../sprint-executor.js";
import { loadContext, appendSprintContext, type FailureRecord } from "../../context.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("evaluator parseEvalReport", () => {
  // --- JSON verdict 解析（主路径：结构化数据优先）---

  test("JSON verdict takes priority over marker counts", () => {
    // 10 AC pass + 2 supplemental pass + 1 supplemental fail → markers say 12/13
    // JSON verdict says 10/10 (only counts ACs) → JSON wins
    const content = `## AC-01\n✅ PASS\n## AC-02\n✅ PASS\n## AC-03\n✅ PASS\n## AC-04\n✅ PASS\n## AC-05\n✅ PASS\n## AC-06\n✅ PASS\n## AC-07\n✅ PASS\n## AC-08\n✅ PASS\n## AC-09\n✅ PASS\n## AC-10\n✅ PASS\n## Supplemental\n✅ PASS stub scan\n✅ PASS security\n❌ FAIL sandbox limitation\n{"passed": true, "pass_count": 10, "total_count": 10}`;
    expect(parseEvalReport(content)).toEqual({ passed: true, passCount: 10, totalCount: 10 });
  });

  // --- ✅/❌ 标记解析（回退路径：无 JSON 时使用）---

  test("all PASS — returns passed=true with correct counts", () => {
    const report = `## AC-01
✅ PASS — works

## AC-02
✅ PASS — works

## AC-03
✅ PASS — works`;
    expect(parseEvalReport(report)).toEqual({ passed: true, passCount: 3, totalCount: 3 });
  });

  test("mixed PASS/FAIL — returns passed=false with correct counts", () => {
    const report = `## AC-01
✅ PASS — works

## AC-02
❌ FAIL — broken

## AC-03
✅ PASS — works`;
    expect(parseEvalReport(report)).toEqual({ passed: false, passCount: 2, totalCount: 3 });
  });

  test("all FAIL — returns passed=false", () => {
    const report = `## AC-01
❌ FAIL — broken

## AC-02
❌ FAIL — also broken`;
    expect(parseEvalReport(report)).toEqual({ passed: false, passCount: 0, totalCount: 2 });
  });

  test("single AC — works correctly", () => {
    expect(parseEvalReport(`## AC-01\n✅ PASS — single criterion met`)).toEqual({
      passed: true, passCount: 1, totalCount: 1,
    });
  });

  // --- JSON-only 内容（无标记时也能解析）---

  test("falls back to JSON when no markers present", () => {
    const content = `The evaluation is complete.\n{"passed": true, "pass_count": 5, "total_count": 5}`;
    expect(parseEvalReport(content)).toEqual({ passed: true, passCount: 5, totalCount: 5 });
  });

  test("JSON-only content", () => {
    expect(parseEvalReport(`{"passed": false, "pass_count": 2, "total_count": 4}`)).toEqual({
      passed: false, passCount: 2, totalCount: 4,
    });
  });

  test("JSON fallback with passed=false", () => {
    const content = `Check complete.\n{"passed": false, "pass_count": 1, "total_count": 3}`;
    expect(parseEvalReport(content)).toEqual({ passed: false, passCount: 1, totalCount: 3 });
  });

  // --- JSON 优先于标记 ---

  test("JSON verdict overrides conflicting markers", () => {
    const content = `## AC-01\n✅ PASS\n## AC-02\n❌ FAIL\n{"passed": true, "pass_count": 5, "total_count": 5}`;
    // JSON 声明 5/5 通过 — 作为评估器的权威声明，优先于标记
    expect(parseEvalReport(content)).toEqual({ passed: true, passCount: 5, totalCount: 5 });
  });

  // --- 边界情况 ---

  test("empty content — defaults to FAIL", () => {
    expect(parseEvalReport("")).toEqual({ passed: false, passCount: 0, totalCount: 0 });
  });

  test("text without markers or JSON — defaults to FAIL", () => {
    expect(parseEvalReport("Evaluation notes without any pass/fail markers")).toEqual({
      passed: false, passCount: 0, totalCount: 0,
    });
  });

  test("malformed JSON — defaults to FAIL", () => {
    expect(parseEvalReport(`{"passed": true, broken`)).toEqual({
      passed: false, passCount: 0, totalCount: 0,
    });
  });

  test("JSON missing optional fields — defaults to 0", () => {
    expect(parseEvalReport(`{"passed": true}`)).toEqual({ passed: true, passCount: 0, totalCount: 0 });
  });

  // --- 真实 fixture 解析 ---

  test("parses real pass fixture", () => {
    const report = `# Evaluation Report — Attempt 1

## AC-01: Default greeting
✅ PASS — \`node index.js\` outputs "Hello, World!"

## AC-02: Custom name greeting
✅ PASS — \`node index.js --name Alice\` outputs "Hello, Alice!"

## AC-03: Package.json exists
✅ PASS — package.json contains correct name field

{"passed": true, "pass_count": 3, "total_count": 3}`;
    expect(parseEvalReport(report)).toEqual({ passed: true, passCount: 3, totalCount: 3 });
  });

  test("parses real fail fixture", () => {
    const report = `# Evaluation Report — Attempt 1

## AC-01: Default greeting
✅ PASS — works

## AC-02: Custom name greeting
❌ FAIL — outputs "Hello, undefined!" instead of "Hello, Alice!"

## AC-03: Package.json exists
✅ PASS — correct

{"passed": false, "pass_count": 2, "total_count": 3}`;
    expect(parseEvalReport(report)).toEqual({ passed: false, passCount: 2, totalCount: 3 });
  });
});

// --- 失败记忆累积 ---

describe("extractFailedItems", () => {
  test("extracts failed AC items with section headers", () => {
    const report = `## AC-01: Default greeting
✅ PASS — works

## AC-02: Custom name greeting
❌ FAIL — outputs "Hello, undefined!" instead of "Hello, Alice!"

## AC-03: Package.json
✅ PASS — correct

{"passed": false, "pass_count": 2, "total_count": 3}`;
    const items = extractFailedItems(report);
    expect(items).toHaveLength(1);
    expect(items[0]).toContain("AC-02: Custom name greeting");
  });

  test("extracts multiple failed items", () => {
    const report = `## AC-01
❌ FAIL — missing file

## AC-02
✅ PASS

## AC-03
❌ FAIL — wrong output`;
    const items = extractFailedItems(report);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain("AC-01");
    expect(items[1]).toContain("AC-03");
  });

  test("includes context lines (expected/actual)", () => {
    const report = `## AC-05: Node List API
❌ FAIL — wrong response format
**Expected:** [{"id":"..."}]
**Actual:** {"total":5,"items":[...]}`;
    const items = extractFailedItems(report);
    expect(items).toHaveLength(1);
    expect(items[0]).toContain("Expected");
    expect(items[0]).toContain("Actual");
  });

  test("returns empty array for all-pass report", () => {
    const report = `## AC-01
✅ PASS
## AC-02
✅ PASS
{"passed": true, "pass_count": 2, "total_count": 2}`;
    expect(extractFailedItems(report)).toEqual([]);
  });

  test("returns empty for empty report", () => {
    expect(extractFailedItems("")).toEqual([]);
  });

  test("caps each item at 300 chars", () => {
    const longReason = "x".repeat(400);
    const report = `## AC-01
❌ FAIL — ${longReason}`;
    const items = extractFailedItems(report);
    expect(items[0].length).toBeLessThanOrEqual(300);
  });
});

describe("extractPassedItems", () => {
  test("extracts passed AC names", () => {
    const report = "✅ PASS AC-01: Node CRUD\n❌ FAIL AC-02: Sync\n✅ PASS ARCH-01: imports";
    const items = extractPassedItems(report);
    expect(items).toEqual(["AC-01: Node CRUD", "ARCH-01: imports"]);
  });

  test("returns empty for no passes", () => {
    expect(extractPassedItems("❌ FAIL AC-01: broken")).toEqual([]);
    expect(extractPassedItems("")).toEqual([]);
  });
});

describe("buildFailureHistorySection", () => {
  test("returns empty string for no failures", () => {
    expect(buildFailureHistorySection([])).toBe("");
  });

  test("formats single attempt failure", () => {
    const history: FailureRecord[] = [
      { attempt: 1, failedItems: ["AC-01: missing file", "AC-03: wrong output"] },
    ];
    const section = buildFailureHistorySection(history);
    expect(section).toContain("PREVIOUS FAILURE HISTORY");
    expect(section).toContain("Attempt 1:");
    expect(section).toContain("- AC-01: missing file");
    expect(section).toContain("- AC-03: wrong output");
    expect(section).toContain("WILL fail again");
  });

  test("formats multiple attempt failures", () => {
    const history: FailureRecord[] = [
      { attempt: 1, failedItems: ["AC-01: error A"] },
      { attempt: 2, failedItems: ["AC-01: error B", "AC-05: error C"] },
    ];
    const section = buildFailureHistorySection(history);
    expect(section).toContain("Attempt 1:");
    expect(section).toContain("Attempt 2:");
    expect(section).toContain("error A");
    expect(section).toContain("error B");
    expect(section).toContain("error C");
  });
});

// --- context.md 跨 Sprint 知识传递 ---

describe("loadContext", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-ctx-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns empty string when context.md does not exist", () => {
    expect(loadContext(tmpDir)).toBe("");
  });

  test("returns file content when context.md exists", () => {
    fs.writeFileSync(path.join(tmpDir, "context.md"), "# Test Context\n- Use Bun\n");
    expect(loadContext(tmpDir)).toBe("# Test Context\n- Use Bun\n");
  });
});

describe("appendSprintContext", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-ctx-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates context.md if it does not exist", () => {
    appendSprintContext(tmpDir, "sprint-01", true, 1, []);
    const content = fs.readFileSync(path.join(tmpDir, "context.md"), "utf-8");
    expect(content).toContain("# Loom Execution Context");
    expect(content).toContain("sprint-01: ✅ passed (attempt 1)");
  });

  test("appends to existing context.md without overwriting", () => {
    fs.writeFileSync(path.join(tmpDir, "context.md"), "# Loom Execution Context\n\n## Environment\n- Bun 1.3.10\n");
    appendSprintContext(tmpDir, "sprint-01", true, 2, []);
    const content = fs.readFileSync(path.join(tmpDir, "context.md"), "utf-8");
    expect(content).toContain("## Environment");
    expect(content).toContain("Bun 1.3.10");
    expect(content).toContain("sprint-01: ✅ passed (attempt 2)");
  });

  test("records failure status correctly", () => {
    appendSprintContext(tmpDir, "sprint-02", false, 3, []);
    const content = fs.readFileSync(path.join(tmpDir, "context.md"), "utf-8");
    expect(content).toContain("sprint-02: ❌ failed (3 attempts)");
  });

  test("includes failure constraints from failureHistory", () => {
    const history: FailureRecord[] = [
      { attempt: 1, failedItems: ["API returns {total, items} but contract expects raw array"] },
      { attempt: 2, failedItems: ["API returns {total, items} but contract expects raw array", "camelCase action name"] },
    ];
    appendSprintContext(tmpDir, "sprint-02", false, 3, history);
    const content = fs.readFileSync(path.join(tmpDir, "context.md"), "utf-8");
    expect(content).toContain("## Constraints from sprint-02");
    expect(content).toContain("API returns {total, items} but contract expects raw array");
    expect(content).toContain("camelCase action name");
  });

  test("deduplicates failure constraints", () => {
    const history: FailureRecord[] = [
      { attempt: 1, failedItems: ["same error"] },
      { attempt: 2, failedItems: ["same error"] },
    ];
    appendSprintContext(tmpDir, "sprint-01", true, 3, history);
    const content = fs.readFileSync(path.join(tmpDir, "context.md"), "utf-8");
    const matches = content.match(/same error/g);
    expect(matches?.length).toBe(1);
  });

  test("accumulates across multiple sprints", () => {
    appendSprintContext(tmpDir, "sprint-01", true, 1, []);
    appendSprintContext(tmpDir, "sprint-02", true, 2, [
      { attempt: 1, failedItems: ["fixed on retry"] },
    ]);
    const content = fs.readFileSync(path.join(tmpDir, "context.md"), "utf-8");
    expect(content).toContain("sprint-01: ✅ passed (attempt 1)");
    expect(content).toContain("sprint-02: ✅ passed (attempt 2)");
    expect(content).toContain("Constraints from sprint-02");
  });
});

// --- 设计专项重试检测 ---

describe("isDesignOnlyFailure", () => {
  test("returns true when all failures are DESIGN: prefixed", () => {
    const report = `## AC-01\n✅ PASS\n## AC-02\n✅ PASS\n## Source Code Review\n❌ FAIL DESIGN: Error handling uses bare strings instead of typed errors`;
    expect(isDesignOnlyFailure(report)).toBe(true);
  });

  test("returns true when all failures are CRITICAL: prefixed", () => {
    const report = `## AC-01\n✅ PASS\n❌ FAIL CRITICAL: Implementation violates spec intent`;
    expect(isDesignOnlyFailure(report)).toBe(true);
  });

  test("returns false when mixed with behavioral failures", () => {
    const report = `## AC-01\n❌ FAIL — wrong output\n## Source Code Review\n❌ FAIL DESIGN: poor abstraction`;
    expect(isDesignOnlyFailure(report)).toBe(false);
  });

  test("returns false when no failures exist", () => {
    const report = `## AC-01\n✅ PASS\n## AC-02\n✅ PASS`;
    expect(isDesignOnlyFailure(report)).toBe(false);
  });

  test("returns false for empty report", () => {
    expect(isDesignOnlyFailure("")).toBe(false);
  });
});
