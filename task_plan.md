# Task Plan: AC Verification Redesign Assessment

## Goal
Produce an independent evidence-based assessment of the proposed Loom AC verification redesign, separating facts, inferences, and judgments, and identifying weak assumptions and alternatives.

## Current Phase
Phase 1

## Phases
### Phase 1: Requirements & Discovery
- [x] Understand user intent
- [x] Identify constraints and requirements
- [x] Document findings in findings.md
- **Status:** complete

### Phase 2: Evidence Collection
- [x] Read the cited source files
- [x] Read the redesign document
- [ ] Inspect surrounding code paths only where needed to remove ambiguity
- **Status:** in_progress

### Phase 3: Assessment
- [ ] Distinguish FACT / INFERENCE / JUDGMENT
- [ ] Evaluate the redesign thesis against code reality
- [ ] Identify plausible alternative hypotheses
- **Status:** pending

### Phase 4: Verification & Delivery
- [ ] Check claims against file references
- [ ] Produce final structured debate response
- **Status:** pending

## Key Questions
1. Does the current engine actually require stdout exact match, or is the real behavior looser than the proposal implies?
2. Which parts of the redesign need prompt-only changes versus executor changes?
3. What failure modes remain if structural and quality-gate checks move entirely into evaluator judgment?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Use planning files for this analysis | Task is multi-step research with many source inspections and explicit evidence requirements |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| None so far | 1 | Not applicable |

## Notes
- Must keep all claims tied to repository evidence or mark them UNDERDETERMINED.
- User explicitly disables forced TDD unless requested.
