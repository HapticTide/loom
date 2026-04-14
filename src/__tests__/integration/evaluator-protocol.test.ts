import { describe, test, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseEvalReport } from "../../sprint-executor.js";

describe("evaluator integration", () => {
  let tmpDir: string;

  function setup(): { sprintDir: string } {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-eval-test-"));
    const sprintDir = path.join(tmpDir, "sprint-01");
    fs.mkdirSync(sprintDir);
    return { sprintDir };
  }

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("event stream capture: response saved directly as eval-report.md", () => {
    const { sprintDir } = setup();
    const reportPath = path.join(sprintDir, "eval-report.md");

    // 模拟从事件流捕获的评估器响应
    const agentResponse = `# Evaluation Report

## AC-01: Default greeting
✅ PASS — works correctly

## AC-02: Custom name greeting
❌ FAIL — outputs wrong name

{"passed": false, "pass_count": 1, "total_count": 2}`;

    // 框架直接将事件流响应写入报告文件
    fs.writeFileSync(reportPath, agentResponse);
    expect(fs.existsSync(reportPath)).toBe(true);

    // 解析报告（使用与事件流响应相同的内容）
    const verdict = parseEvalReport(agentResponse);
    expect(verdict).toEqual({ passed: false, passCount: 1, totalCount: 2 });
  });

  test("archive pattern: report is archived per attempt to .runs/ dir", () => {
    const { sprintDir } = setup();
    const reportPath = path.join(sprintDir, "eval-report.md");

    // 创建 .runs/ 目录（模拟运行时产物隔离）
    const runsDir = path.join(tmpDir, ".runs", "sprint-01");
    fs.mkdirSync(runsDir, { recursive: true });

    const reportContent = `## AC-01\n✅ PASS\n## AC-02\n❌ FAIL`;
    fs.writeFileSync(reportPath, reportContent);

    // 归档到 .runs/ 目录
    const attempt = 1;
    const archivePath = path.join(runsDir, `eval-report-attempt-${attempt}.md`);
    fs.copyFileSync(reportPath, archivePath);

    expect(fs.existsSync(archivePath)).toBe(true);
    expect(fs.readFileSync(archivePath, "utf-8")).toBe(reportContent);

    // 第二次尝试覆盖 eval-report.md 但独立归档
    const attempt2Content = `## AC-01\n✅ PASS\n## AC-02\n✅ PASS`;
    fs.writeFileSync(reportPath, attempt2Content);
    const archivePath2 = path.join(runsDir, `eval-report-attempt-2.md`);
    fs.copyFileSync(reportPath, archivePath2);

    expect(fs.readFileSync(archivePath, "utf-8")).toBe(reportContent);
    expect(fs.readFileSync(archivePath2, "utf-8")).toBe(attempt2Content);
  });

  test("parseEvalReport works with event stream content", () => {
    const response = `## AC-01\n✅ PASS\n## AC-02\n✅ PASS\n## AC-03\n✅ PASS`;
    expect(parseEvalReport(response)).toEqual({ passed: true, passCount: 3, totalCount: 3 });
  });
});
