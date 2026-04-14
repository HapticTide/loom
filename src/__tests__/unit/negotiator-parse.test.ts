import { describe, test, expect } from "bun:test";
import { parseVerdict } from "../../negotiator.js";

describe("negotiator parseVerdict", () => {
  test("returns APPROVED for clear approved verdict", () => {
    const content = `## Some review notes

## Verdict: APPROVED
All criteria are met.`;
    expect(parseVerdict(content)).toBe("APPROVED");
  });

  test("returns REVISE for clear revise verdict", () => {
    const content = `## Some review notes

## Verdict: REVISE
### Revision Reasons
- AC-02 needs fix`;
    expect(parseVerdict(content)).toBe("REVISE");
  });

  test("case insensitive matching", () => {
    expect(parseVerdict("## verdict: approved")).toBe("APPROVED");
    expect(parseVerdict("## VERDICT: REVISE")).toBe("REVISE");
  });

  test("handles extra whitespace in verdict header", () => {
    expect(parseVerdict("##  Verdict:  APPROVED")).toBe("APPROVED");
    expect(parseVerdict("##   Verdict:   REVISE")).toBe("REVISE");
  });

  test("when both exist, uses the last one", () => {
    const content = `## Verdict: REVISE
Some feedback...

## Verdict: APPROVED
After revision, all good.`;
    expect(parseVerdict(content)).toBe("APPROVED");
  });

  test("when both exist reversed, uses the last one", () => {
    const content = `## Verdict: APPROVED
Initially good...

## Verdict: REVISE
On second thought, needs work.`;
    expect(parseVerdict(content)).toBe("REVISE");
  });

  test("defaults to REVISE when no verdict found", () => {
    expect(parseVerdict("No verdict here")).toBe("REVISE");
  });

  test("defaults to REVISE for empty string", () => {
    expect(parseVerdict("")).toBe("REVISE");
  });

  test("parses verdict from real review fixture", () => {
    const content = `# Contract Review

## AC-01: Default greeting
✅ Verification command is concrete and deterministic.

## AC-02: Custom name greeting
✅ Verification command is concrete and deterministic.

## Verdict: APPROVED
All acceptance criteria have concrete, automatable verification commands.`;
    expect(parseVerdict(content)).toBe("APPROVED");
  });

  test("parses REVISE verdict from fixture with reasons", () => {
    const content = `# Contract Review

## AC-02: Custom name greeting
❌ The expected output format is ambiguous

## Verdict: REVISE
### Revision Reasons
- AC-02: Expected output must specify exact string`;
    expect(parseVerdict(content)).toBe("REVISE");
  });
});
