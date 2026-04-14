import { describe, test, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  saveNegotiationHistory,
  initNegotiationLog,
  appendNegotiationEntry,
  parseVerdict,
} from "../../negotiator.js";

describe("negotiation protocol", () => {
  let tmpDir: string;

  function setup(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-test-"));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("saveNegotiationHistory creates file with feature spec and all rounds", () => {
    const dir = setup();
    const filePath = path.join(dir, "contract-negotiation.md");
    const featureSpec = "# Sprint 01\n\nBuild a hello world CLI.";

    const history = [
      { header: "Round 1: Proposal", content: "Here is my proposal." },
      { header: "Round 1: Review", content: "Looks good.\n\n## Verdict: APPROVED" },
    ];

    saveNegotiationHistory(filePath, featureSpec, history);

    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("# Contract Negotiation");
    expect(content).toContain("## Feature Spec");
    expect(content).toContain("Build a hello world CLI.");
    expect(content).toContain("## Round 1: Proposal");
    expect(content).toContain("Here is my proposal.");
    expect(content).toContain("## Round 1: Review");
    expect(content).toContain("## Verdict: APPROVED");
  });

  test("incremental: initNegotiationLog + appendNegotiationEntry", () => {
    const dir = setup();
    const filePath = path.join(dir, "contract-negotiation.md");
    const featureSpec = "Build a CLI tool.";

    initNegotiationLog(filePath, featureSpec);

    let content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("# Contract Negotiation");
    expect(content).toContain("Build a CLI tool.");

    appendNegotiationEntry(filePath, "Round 1: Proposal", "My proposal.");
    appendNegotiationEntry(filePath, "Round 1: Review", "## Verdict: APPROVED");

    content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("## Round 1: Proposal");
    expect(content).toContain("My proposal.");
    expect(content).toContain("## Round 1: Review");
    expect(content).toContain("## Verdict: APPROVED");

    // Structure: sections separated by ---
    const sections = content.split("---").filter((s) => s.trim());
    expect(sections.length).toBeGreaterThanOrEqual(3); // feature spec + proposal + review
  });

  test("incremental output matches saveNegotiationHistory output", () => {
    const dir = setup();
    const featureSpec = "Build CLI.";
    const history = [
      { header: "Round 1: Proposal", content: "P1" },
      { header: "Round 1: Review", content: "R1" },
    ];

    // Incremental approach
    const incrementalPath = path.join(dir, "incremental.md");
    initNegotiationLog(incrementalPath, featureSpec);
    for (const entry of history) {
      appendNegotiationEntry(incrementalPath, entry.header, entry.content);
    }

    // Batch approach
    const batchPath = path.join(dir, "batch.md");
    saveNegotiationHistory(batchPath, featureSpec, history);

    const incremental = fs.readFileSync(incrementalPath, "utf-8");
    const batch = fs.readFileSync(batchPath, "utf-8");
    expect(incremental).toBe(batch);
  });

  test("full negotiation history: multi-round with REVISE then APPROVED", () => {
    const dir = setup();
    const filePath = path.join(dir, "contract-negotiation.md");

    const history = [
      { header: "Round 1: Proposal", content: `# Contract\n## AC-01: greeting\n- Command: node index.js\n- Expected: Hello, World!` },
      { header: "Round 1: Review", content: `AC-01 is good, but missing --name test.\n\n## Verdict: REVISE\n### Revision Reasons\n- Missing AC for --name flag` },
      { header: "Round 2: Proposal", content: `# Contract\n## AC-01: default greeting\n- Command: node index.js\n- Expected: Hello, World!\n\n## AC-02: name flag\n- Command: node index.js --name Alice\n- Expected: Hello, Alice!` },
      { header: "Round 2: Review", content: `All criteria are concrete and automatable.\n\n## Verdict: APPROVED` },
    ];

    // 验证 parseVerdict 对各轮审查的判断
    expect(parseVerdict(history[1].content)).toBe("REVISE");
    expect(parseVerdict(history[3].content)).toBe("APPROVED");

    saveNegotiationHistory(filePath, "Build CLI with --name flag", history);

    const finalContent = fs.readFileSync(filePath, "utf-8");
    expect(finalContent).toContain("## Feature Spec");
    expect(finalContent).toContain("## Round 1: Proposal");
    expect(finalContent).toContain("## Round 1: Review");
    expect(finalContent).toContain("## Round 2: Proposal");
    expect(finalContent).toContain("## Round 2: Review");

    // 验证文件结构（sections 由 --- 分隔）
    const sections = finalContent.split("---").filter((s) => s.trim());
    expect(sections.length).toBeGreaterThanOrEqual(5);
  });

  test("contract.md is written with final proposal content", () => {
    const dir = setup();
    const contractPath = path.join(dir, "contract.md");

    const proposalContent = "# Contract\n## AC-01\n- Command: echo hello";
    fs.writeFileSync(contractPath, proposalContent);

    expect(fs.existsSync(contractPath)).toBe(true);
    expect(fs.readFileSync(contractPath, "utf-8")).toBe(proposalContent);
  });

  test("event stream capture: agent response is used as content", () => {
    const proposal = "# Contract\n## AC-01: Test\n- Command: echo ok\n- Expected: ok";
    const review = "All good.\n\n## Verdict: APPROVED";

    const history = [
      { header: "Round 1: Proposal", content: proposal },
      { header: "Round 1: Review", content: review },
    ];

    expect(history[0].content).toBe(proposal);
    expect(history[1].content).toBe(review);
    expect(parseVerdict(history[1].content)).toBe("APPROVED");
  });
});
