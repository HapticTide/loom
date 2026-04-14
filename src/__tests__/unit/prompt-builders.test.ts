import { describe, test, expect } from "bun:test";
import {
  buildGeneratorPrompt,
  buildEvaluatorPrompt,
  getLastEntry,
  buildReviewSummary,
  extractRevisionReasons,
  extractAcIds,
} from "../../negotiator.js";

describe("negotiator prompt builders", () => {
  const roleInstructions = "You are a code generator.";
  const featureSpec = "# Sprint 01\n\nBuild a hello world CLI.";
  const emptyHistory: Array<{ header: string; content: string }> = [];
  const historyWithRound1 = [
    { header: "Round 1: Proposal", content: "My proposal content" },
    { header: "Round 1: Review", content: "Needs revision.\n\n## Verdict: REVISE\n### Revision Reasons\n- Missing AC for --name flag" },
  ];

  describe("buildGeneratorPrompt", () => {
    test("includes role instructions", () => {
      const prompt = buildGeneratorPrompt(roleInstructions, featureSpec, emptyHistory, 1);
      expect(prompt).toContain("You are a code generator.");
    });

    test("includes feature spec in prompt", () => {
      const prompt = buildGeneratorPrompt(roleInstructions, featureSpec, emptyHistory, 1);
      expect(prompt).toContain("Build a hello world CLI.");
    });

    test("round 1 mentions round number", () => {
      const prompt = buildGeneratorPrompt(roleInstructions, featureSpec, emptyHistory, 1);
      expect(prompt).toContain("Round 1");
    });

    test("round 1 does NOT include history", () => {
      const prompt = buildGeneratorPrompt(roleInstructions, featureSpec, emptyHistory, 1);
      expect(prompt).not.toContain("Previous Proposal");
      expect(prompt).not.toContain("Evaluator Feedback");
    });

    test("round 2+ mentions revision/feedback", () => {
      const prompt = buildGeneratorPrompt(roleInstructions, featureSpec, historyWithRound1, 2);
      expect(prompt.toLowerCase()).toMatch(/revis|feedback|concerns/);
    });

    test("round 2+ includes latest proposal and review only (windowed)", () => {
      const prompt = buildGeneratorPrompt(roleInstructions, featureSpec, historyWithRound1, 2);
      expect(prompt).toContain("My proposal content");
      expect(prompt).toContain("Needs revision.");
      expect(prompt).toContain("Your Previous Proposal");
      expect(prompt).toContain("Evaluator Feedback");
    });

    test("round 3 only includes latest proposal/review, not round 1", () => {
      const historyWith2Rounds = [
        { header: "Round 1: Proposal", content: "Old proposal from round 1" },
        { header: "Round 1: Review", content: "Old review.\n\n## Verdict: REVISE\n### Revision Reasons\n- Missing feature X" },
        { header: "Round 2: Proposal", content: "Revised proposal from round 2" },
        { header: "Round 2: Review", content: "Still needs work.\n\n## Verdict: REVISE\n### Revision Reasons\n- Missing feature Y" },
      ];
      const prompt = buildGeneratorPrompt(roleInstructions, featureSpec, historyWith2Rounds, 3);
      // Should contain LATEST only
      expect(prompt).toContain("Revised proposal from round 2");
      expect(prompt).toContain("Still needs work.");
      // Should NOT contain old entries
      expect(prompt).not.toContain("Old proposal from round 1");
      expect(prompt).not.toContain("Old review.");
    });

    test("prompt requires exit-code-only preflight verification", () => {
      const prompt = buildGeneratorPrompt(roleInstructions, featureSpec, emptyHistory, 1);
      expect(prompt.toLowerCase()).toContain("exit code");
      expect(prompt.toLowerCase()).toContain("[preflight]");
    });

    test("prompt mentions deliverables", () => {
      const prompt = buildGeneratorPrompt(roleInstructions, featureSpec, emptyHistory, 1);
      expect(prompt.toLowerCase()).toContain("deliverables");
    });

    test("instructs agent not to write files", () => {
      const prompt = buildGeneratorPrompt(roleInstructions, featureSpec, emptyHistory, 1);
      expect(prompt.toLowerCase()).toContain("do not write to any files");
    });

    test("task directive appears before role instructions (task-first ordering)", () => {
      const prompt = buildGeneratorPrompt(roleInstructions, featureSpec, emptyHistory, 1);
      const taskIndex = prompt.indexOf("TASK:");
      const roleIndex = prompt.indexOf(roleInstructions);
      expect(taskIndex).toBeLessThan(roleIndex);
    });
  });

  describe("buildEvaluatorPrompt", () => {
    const historyWithProposal = [
      { header: "Round 1: Proposal", content: "# Contract\n## AC-01: Test" },
    ];

    test("includes role instructions", () => {
      const prompt = buildEvaluatorPrompt(roleInstructions, featureSpec, historyWithProposal);
      expect(prompt).toContain("You are a code generator.");
    });

    test("includes feature spec and latest proposal", () => {
      const prompt = buildEvaluatorPrompt(roleInstructions, featureSpec, historyWithProposal);
      expect(prompt).toContain("Build a hello world CLI.");
      expect(prompt).toContain("# Contract");
      expect(prompt).toContain("Latest Proposal");
    });

    test("no review summary on first round", () => {
      const prompt = buildEvaluatorPrompt(roleInstructions, featureSpec, historyWithProposal);
      expect(prompt).not.toContain("Previous Rounds Summary");
    });

    test("includes review summary on later rounds", () => {
      const historyRound2 = [
        { header: "Round 1: Proposal", content: "Proposal v1" },
        { header: "Round 1: Review", content: "Needs fix.\n\n## Verdict: REVISE\n### Revision Reasons\n- Missing AC for login" },
        { header: "Round 2: Proposal", content: "Proposal v2 with login AC" },
      ];
      const prompt = buildEvaluatorPrompt(roleInstructions, featureSpec, historyRound2, 2);
      expect(prompt).toContain("Previous Rounds Summary");
      expect(prompt).toContain("Round 1: REVISE");
      expect(prompt).toContain("Missing AC for login");
      // Should NOT contain old proposal text
      expect(prompt).not.toContain("Proposal v1");
    });

    test("requires APPROVED or REVISE verdict format", () => {
      const prompt = buildEvaluatorPrompt(roleInstructions, featureSpec, historyWithProposal);
      expect(prompt).toContain("## Verdict: APPROVED");
      expect(prompt).toContain("## Verdict: REVISE");
    });

    test("explicitly discourages edge case revisions (optimization)", () => {
      const prompt = buildEvaluatorPrompt(roleInstructions, featureSpec, historyWithProposal);
      expect(prompt.toLowerCase()).toContain("do not request revisions for");
      expect(prompt.toLowerCase()).toContain("additional edge cases");
    });

    test("mentions execution-blocking issues only", () => {
      const prompt = buildEvaluatorPrompt(roleInstructions, featureSpec, historyWithProposal);
      expect(prompt.toLowerCase()).toContain("execution-blocking");
    });

    test("prohibits stylistic/nice-to-have revisions", () => {
      const prompt = buildEvaluatorPrompt(roleInstructions, featureSpec, historyWithProposal);
      expect(prompt.toLowerCase()).toContain("stylistic");
      expect(prompt.toLowerCase()).toContain("nice to have");
    });

    test("instructs agent not to write files", () => {
      const prompt = buildEvaluatorPrompt(roleInstructions, featureSpec, historyWithProposal);
      expect(prompt.toLowerCase()).toContain("do not write to any files");
    });

    test("requires preflight command safety checks", () => {
      const prompt = buildEvaluatorPrompt(roleInstructions, featureSpec, historyWithProposal);
      expect(prompt).toContain("PREFLIGHT COMMAND SAFETY");
      expect(prompt.toLowerCase()).toContain("no pipes");
      expect(prompt.toLowerCase()).toContain("exit code");
    });

    test("requires quality gate coverage in contract", () => {
      const prompt = buildEvaluatorPrompt(roleInstructions, featureSpec, historyWithProposal);
      expect(prompt).toContain("QUALITY GATE COVERAGE");
      expect(prompt.toLowerCase()).toContain("boundary safety");
    });

    test("task directive appears before role instructions (task-first ordering)", () => {
      const prompt = buildEvaluatorPrompt(roleInstructions, featureSpec, historyWithProposal);
      const taskIndex = prompt.indexOf("TASK:");
      const roleIndex = prompt.indexOf(roleInstructions);
      expect(taskIndex).toBeLessThan(roleIndex);
    });

    test("uses structural coverage criterion instead of implementation distinguishability", () => {
      const prompt = buildEvaluatorPrompt(roleInstructions, featureSpec, historyWithProposal);
      expect(prompt).toContain("STRUCTURAL COVERAGE");
      expect(prompt).not.toContain("IMPLEMENTATION DISTINGUISHABILITY");
      expect(prompt.toLowerCase()).toContain("honest mistake");
      expect(prompt.toLowerCase()).toContain("adversarial");
    });

    test("no focused review note on rounds 1-2", () => {
      const prompt1 = buildEvaluatorPrompt(roleInstructions, featureSpec, historyWithProposal, 1);
      const prompt2 = buildEvaluatorPrompt(roleInstructions, featureSpec, historyWithProposal, 2);
      expect(prompt1).not.toContain("FOCUSED REVIEW");
      expect(prompt2).not.toContain("FOCUSED REVIEW");
    });

    test("includes focused review note on round 3+", () => {
      const historyRound3 = [
        { header: "Round 1: Proposal", content: "P1" },
        { header: "Round 1: Review", content: "## Verdict: REVISE\n### Revision Reasons\n- Issue X" },
        { header: "Round 2: Proposal", content: "P2" },
        { header: "Round 2: Review", content: "## Verdict: REVISE\n### Revision Reasons\n- Issue Y" },
        { header: "Round 3: Proposal", content: "P3" },
      ];
      const prompt = buildEvaluatorPrompt(roleInstructions, featureSpec, historyRound3, 3);
      expect(prompt).toContain("FOCUSED REVIEW (Round 3)");
      expect(prompt).toContain("Do NOT re-evaluate unchanged ACs");
    });
  });
});

describe("negotiator helpers", () => {
  describe("getLastEntry", () => {
    test("returns last proposal from history", () => {
      const history = [
        { header: "Round 1: Proposal", content: "P1" },
        { header: "Round 1: Review", content: "R1" },
        { header: "Round 2: Proposal", content: "P2" },
      ];
      expect(getLastEntry(history, "Proposal")).toBe("P2");
    });

    test("returns last review from history", () => {
      const history = [
        { header: "Round 1: Proposal", content: "P1" },
        { header: "Round 1: Review", content: "R1" },
        { header: "Round 2: Proposal", content: "P2" },
        { header: "Round 2: Review", content: "R2" },
      ];
      expect(getLastEntry(history, "Review")).toBe("R2");
    });

    test("returns empty string if type not found", () => {
      expect(getLastEntry([], "Proposal")).toBe("");
      expect(getLastEntry([{ header: "Round 1: Proposal", content: "P1" }], "Review")).toBe("");
    });
  });

  describe("extractRevisionReasons", () => {
    test("extracts reasons from structured review", () => {
      const review = "Some analysis.\n\n## Verdict: REVISE\n### Revision Reasons\n- Missing AC for login\n- Non-deterministic output in AC-03";
      const reasons = extractRevisionReasons(review);
      expect(reasons).toEqual(["Missing AC for login", "Non-deterministic output in AC-03"]);
    });

    test("returns empty array if no reasons section", () => {
      const review = "All good.\n\n## Verdict: APPROVED";
      expect(extractRevisionReasons(review)).toEqual([]);
    });

    test("handles bullet points with * marker", () => {
      const review = "## Verdict: REVISE\n### Revision Reasons\n* Reason A\n* Reason B";
      expect(extractRevisionReasons(review)).toEqual(["Reason A", "Reason B"]);
    });
  });

  describe("buildReviewSummary", () => {
    test("returns empty string for no reviews", () => {
      expect(buildReviewSummary([])).toBe("");
      expect(buildReviewSummary([{ header: "Round 1: Proposal", content: "P1" }])).toBe("");
    });

    test("summarizes REVISE reviews with reasons", () => {
      const history = [
        { header: "Round 1: Proposal", content: "P1" },
        { header: "Round 1: Review", content: "Bad.\n\n## Verdict: REVISE\n### Revision Reasons\n- Missing login AC\n- Non-deterministic timestamp" },
      ];
      const summary = buildReviewSummary(history);
      expect(summary).toContain("1 rounds completed");
      expect(summary).toContain("Round 1: REVISE");
      expect(summary).toContain("Missing login AC");
      expect(summary).toContain("Non-deterministic timestamp");
      expect(summary).toContain("FOCUS");
    });

    test("summarizes APPROVED reviews without reasons", () => {
      const history = [
        { header: "Round 1: Proposal", content: "P1" },
        { header: "Round 1: Review", content: "Good.\n\n## Verdict: APPROVED" },
      ];
      const summary = buildReviewSummary(history);
      expect(summary).toContain("Round 1: APPROVED");
      expect(summary).not.toContain("FOCUS");
    });

    test("summarizes multiple rounds with convergence tracking", () => {
      const history = [
        { header: "Round 1: Proposal", content: "P1" },
        { header: "Round 1: Review", content: "## Verdict: REVISE\n### Revision Reasons\n- `AC-01` Issue A\n- `ARCH-03` Issue B" },
        { header: "Round 2: Proposal", content: "P2" },
        { header: "Round 2: Review", content: "## Verdict: REVISE\n### Revision Reasons\n- `AC-02` Issue C" },
      ];
      const summary = buildReviewSummary(history);
      expect(summary).toContain("2 rounds completed");
      expect(summary).toContain("Resolved in prior rounds: AC-01, ARCH-03");
      expect(summary).toContain("Round 1: REVISE");
      expect(summary).toContain("Round 2: REVISE");
      expect(summary).toContain("FOCUS: Verify whether these Round 2 issues are now addressed");
    });
  });

  describe("extractAcIds", () => {
    test("extracts backtick-wrapped AC IDs", () => {
      expect(extractAcIds("`AC-01` and `ARCH-03` have issues")).toEqual(["AC-01", "ARCH-03"]);
    });

    test("extracts bare AC IDs", () => {
      expect(extractAcIds("AC-02 is not exact")).toEqual(["AC-02"]);
    });

    test("deduplicates", () => {
      expect(extractAcIds("`AC-01` and AC-01 again")).toEqual(["AC-01"]);
    });

    test("returns empty for no AC IDs", () => {
      expect(extractAcIds("No AC references here")).toEqual([]);
    });

    test("extracts DESIGN IDs", () => {
      expect(extractAcIds("`DESIGN-02` is not portable")).toEqual(["DESIGN-02"]);
    });
  });

  // --- context.md 注入 ---

  describe("context injection in negotiation prompts", () => {
    const role = "You are a code generator.";
    const spec = "# Sprint 01\n\nBuild a hello world CLI.";
    const noHistory: Array<{ header: string; content: string }> = [];

    test("generator prompt includes context when provided", () => {
      const context = "- Use Bun APIs\n- Raw arrays for list endpoints";
      const prompt = buildGeneratorPrompt(role, spec, noHistory, 1, context);
      expect(prompt).toContain("## Accumulated Context");
      expect(prompt).toContain("Use Bun APIs");
      expect(prompt).toContain("Raw arrays for list endpoints");
    });

    test("generator prompt omits context section when empty", () => {
      const prompt = buildGeneratorPrompt(role, spec, noHistory, 1, "");
      expect(prompt).not.toContain("## Accumulated Context");
    });

    test("evaluator prompt includes context when provided", () => {
      const context = "- Sprint 01 passed on attempt 3";
      const history = [
        { header: "Round 1: Proposal", content: "Some proposal" },
      ];
      const prompt = buildEvaluatorPrompt(role, spec, history, 1, context);
      expect(prompt).toContain("## Accumulated Context");
      expect(prompt).toContain("Sprint 01 passed on attempt 3");
    });

    test("evaluator prompt omits context section when undefined", () => {
      const history = [
        { header: "Round 1: Proposal", content: "Some proposal" },
      ];
      const prompt = buildEvaluatorPrompt(role, spec, history, 1);
      expect(prompt).not.toContain("## Accumulated Context");
    });
  });
});
