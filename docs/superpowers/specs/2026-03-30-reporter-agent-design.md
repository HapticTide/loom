# Reporter Agent: LLM-Driven Handoff Report

## Problem

Loom's current `reporter.ts` is a template function that produces a build-status summary (sprint pass/fail table + timing). This is useful for CI but insufficient for its actual audience: human reviewers and follow-up coding agents who need to **understand, verify, and take over** the project.

A human reviewer's first questions after receiving loom output:
1. "How do I run this?"
2. "How do I verify it actually works?"
3. "What did it change and why?"

The current report answers none of these.

## Design Principles

### From First Principles

Loom's output has two layers:
- **Code changes** — scattered across project files
- **Final report** — the sole "handoff interface" to human/agent reviewers

The report must serve **two audiences**:
1. **Human reviewers** — quick understanding, manual verification
2. **Follow-up coding agents** (e.g., Claude Code CLI) — execute setup commands, prepare test environment, guide testing

This means the report must be both **readable** and **executable** — commands must be copy-pasteable, verification steps must be concrete enough for an agent to execute programmatically.

### Separation of Concerns

Three types of information are needed for a "testable handoff":

| Type | Responsibility | Example |
|------|---------------|---------|
| **Code artifacts** (seed scripts, start scripts) | Generator, during sprint implementation | `seed.ts`, `docker-compose.yml` |
| **Knowledge artifacts** (how to start, how to test) | Reporter, post-execution synthesis | Quick Start section, Verification Checklist |
| **Environment side effects** (run seeds, create accounts) | Human or follow-up agent, based on report | `npm run seed`, `npm run dev` |

Loom is a **builder**, not a **deployer**. Reporter documents what was built and how to use it; actual execution is downstream.

## Solution

### Architecture Change

Replace the template-rendering `generateReport()` with an LLM-driven report generator that uses the Evaluator runtime.

```
Current:  Orchestrator → reporter.ts (string template) → final-report.md
Proposed: Orchestrator → reporter.ts (prompt builder) → Evaluator runtime → final-report.md
```

### Why Evaluator Runtime

- Reporter is a **one-shot synthesis task** — no retry loops, no negotiation, no contracts
- Creating a separate `reporter` field in `Runtimes` is over-engineering for a single LLM call
- Evaluator's nature (read and judge) is closest to Reporter's (read and synthesize)
- Zero config change, zero interface change

### Why an Agent (not a template)

The handoff report requires information that cannot be extracted by template logic:
- **Startup commands**: may be in `package.json`, `Makefile`, `docker-compose.yml`, or `README.md` — requires reading and understanding project files
- **Environment variables**: scattered across `.env.example`, config files, source code
- **Verification steps**: contract ACs are machine commands (`curl`, `grep`) that need to be translated into human-understandable steps
- **Design decisions**: require synthesizing spec intent against actual implementation choices

This is fundamentally an LLM task, not a string-formatting task.

## Report Structure

The handoff report (`final-report.md`) will have these sections:

### 1. Summary
- One sentence: what was built
- Overall status (all passed / some failed)
- Key design decisions (why this approach)

### 2. Quick Start
- Dependency installation commands
- Environment variables needed (from `.env.example`, config files)
- Start command(s)
- Access URL/port
- All commands must be exact and copy-pasteable

### 3. Test Data & Accounts
- Seed scripts and execution commands
- Test accounts/credentials if any
- What data gets created

### 4. Verification Checklist
- Contract ACs converted to human/agent-executable steps
- Markdown checkbox format: `- [ ] Step description`
- Each step: what to do, what to expect
- Concrete enough for a coding agent to execute programmatically

### 5. What Changed
- Key files added/modified with one-line descriptions
- Grouped by feature/module

### 6. Known Limitations
- Explicit exclusions from spec
- Boundary cases or simplifications
- Failed sprints with reason summary

### 7. Sprint Execution Summary
- Table: Sprint | Status | Attempts | Duration (preserved from current report)

## Implementation Changes

### Files Changed

#### `reporter.ts` (rewrite)

Current: pure template function, no runtime dependency.

New: two functions:

```typescript
// Build the reporter prompt with all loom artifacts embedded
function buildReporterPrompt(result: LoomResult, config: LoomConfig): string

// Call runtime to generate report, write files
export async function generateReport(
  result: LoomResult,
  config: LoomConfig,
  runtime: AgentRuntime
): Promise<void>
```

**Prompt construction strategy:**
- Embed loom artifacts directly in prompt (same pattern as Generator/Evaluator — avoids cross-directory file references)
- Agent runs in `projectRoot`, so it can read project files (package.json, source code, etc.) directly
- Artifacts embedded: `spec.md`, `design-language.md`, sprint contracts, eval reports, serialized LoomResult

**Output handling:**
- Agent response → `final-report.md`
- `loom-result.json` still generated programmatically (template, not LLM) — machine-readable summary must be deterministic

#### `orchestrator.ts` (minimal change)

```typescript
// Before
await generateReport(loomResult, config);

// After
await generateReport(loomResult, config, runtimes.evaluator);
```

Reporter log goes to `reporter.log` in the runs directory. Since `setLogFile` overwrites the previous path on the runtime instance, call it after all sprints are complete (evaluator log is finalized at that point):

```typescript
runtimes.evaluator.setLogFile(path.join(config.runsDir, "reporter.log"));
await generateReport(loomResult, config, runtimes.evaluator);
```

#### `types.ts` (no change)

`LoomResult`, `LoomConfig`, `Runtimes` — all unchanged.

#### `runtime.ts` (no change)

Reuses existing `AgentRuntime.run()`.

### Reporter Prompt Design

The prompt instructs the agent to:
1. Receive all loom artifacts inline (spec, contracts, eval reports, sprint results)
2. Explore the project codebase to extract startup info, env vars, seed scripts
3. Synthesize a structured handoff report
4. Output the report as response text (not write to files)

Key prompt rules:
- **Read-only**: Reporter must NOT create or modify project files
- **Concrete commands**: All Quick Start and Test Data commands must be exact and runnable
- **Specific verification**: "Click the login button and enter test@example.com" not "test the login feature"
- **Audience-aware**: Write for both humans scanning and agents executing

### Test Changes

Current `reporter.test.ts` tests template output (markdown table format, JSON structure). These tests need to be updated:

- Template tests for `loom-result.json` remain (it's still generated programmatically)
- `final-report.md` tests change from template assertions to: verify `buildReporterPrompt()` includes all required artifacts, verify `generateReport()` calls runtime and writes response to file
- May need to mock `AgentRuntime.run()` in tests

## What Does NOT Change

- `loom-result.json` output format (machine-readable, deterministic)
- CLI arguments and configuration
- `Runtimes` interface
- Generator/Evaluator behavior
- Sprint execution flow
- Phase 1-3 behavior

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| LLM produces inconsistent report structure | Prompt is highly structured with explicit section headings; post-processing can validate sections exist |
| Report generation fails (runtime error) | Fallback to current template-based report (degrade gracefully) |
| Added latency (one more LLM call) | Reporter is one-shot, no retry — typically 30-60s. Acceptable given it runs once at the very end |
| Prompt too large (many sprints with full contracts) | For projects with many sprints, truncate eval reports to verdict-only; contracts are typically compact |
