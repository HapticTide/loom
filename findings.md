# Findings & Decisions

## Requirements
- Read the actual code before making claims.
- Separate each point into FACT, INFERENCE, or JUDGMENT.
- Identify at least two plausible alternative hypotheses.
- Challenge weak assumptions instead of optimizing for agreement.
- Output sections: Facts, Main Thesis, Alternative Hypotheses, Likely Weak Assumptions, What Claude Should Verify Next, Open Questions, Confidence.

## Research Findings
- `src/negotiator.ts` generator prompt currently instructs four AC categories, despite text saying "THREE categories"; the numbered list contains BEHAVIORAL, STRUCTURAL, QUALITY GATE, and DESIGN.
- `src/negotiator.ts` evaluator prompt currently enforces structural coverage per deliverable and checks command concreteness and deterministic expected output.
- `src/sprint-executor.ts` `runPreflight()` already treats empty `expected` as automatic pass if the command exits 0.
- `src/sprint-executor.ts` defines `PreflightAC` locally and parses preflight checks solely by `[PREFLIGHT]` tag plus markdown structure; the executor does not inspect AC categories like BEHAVIORAL or STRUCTURAL.
- `.claude/skills/loom/phase-2-workspace.md` explicitly requires QG-1 through QG-4 to be converted into contract ACs during negotiation.
- The redesign document claims shell-based structural/QG commands are inherently brittle and proposes moving that responsibility to DESIGN AC review.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Treat redesign doc as proposal, not fact | It is external rationale and may overstate current engine behavior |
| Validate each claim against code, not against prose | The topic is mechanism reasonableness, so implementation semantics matter most |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Prior session context existed outside planning files | Captured relevant context and continued with direct source inspection |

## Resources
- `/Users/pxy/Developer/loom/src/negotiator.ts`
- `/Users/pxy/Developer/loom/src/sprint-executor.ts`
- `/Users/pxy/Developer/loom/src/types.ts`
- `/Users/pxy/Developer/loom/.claude/skills/loom/phase-2-workspace.md`
- `/Users/pxy/.loom/projects/imwe/on-device-gemma/ac-verification-redesign.md`

## Visual/Browser Findings
- No browser or image inputs used.
