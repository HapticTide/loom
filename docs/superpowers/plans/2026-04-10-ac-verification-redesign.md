# AC 验证机制改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 4 类 AC（BEHAVIORAL, STRUCTURAL, QUALITY GATE, DESIGN）简化为 2 类（PREFLIGHT exit-code-only + DESIGN-AC 全覆盖），消除 LLM 自制 grep/awk/sed 命令在无头子进程中的脆弱性。

**Architecture:** 改动集中在 prompt 工程层（negotiator.ts 的合约格式指导 + sprint-executor.ts 的运行期 prompt + phase-2-workspace.md 的 skill 模板）。引擎执行层（parsePreflightACs / runPreflight）不需要改动——expected 为空时已自动 PASS。四处语义来源必须原子化同步修改，避免半迁移导致协商死循环。

**Tech Stack:** TypeScript (src/), Markdown templates (.claude/skills/)

**核心原则:** 机器做机器擅长的（跑命令看 exit code），LLM 做 LLM 擅长的（读代码判质量）。

**讨论记录:** `.discussions/20260410-1450-ac-verification-redesign.md`（Claude + Codex 共识）

---

## Task 1: 改造 Generator 合约格式指导（negotiator.ts）

**Files:**
- Modify: `src/negotiator.ts:137-178` — `contractFormat` 常量

**改动说明:** 将"THREE categories"改为"TWO categories"，移除 STRUCTURAL AC 和 QUALITY GATE AC 的定义，扩展 DESIGN AC 使其覆盖结构审查和质量门。PREFLIGHT 只保留项目已有的 build/test/lint/typecheck 命令。

- [ ] **Step 1: 替换 contractFormat 中的 AC 分类指导**

将 `src/negotiator.ts:143-160` 从：

```typescript
- THREE categories of verification:
  1. BEHAVIORAL ACs: Verify WHAT the code does (curl, CLI invocation, test runner)
  2. STRUCTURAL ACs: Verify HOW the code is structured (grep, find, ast-grep, wc -l, or similar source analysis). Include at least one structural AC per DELIVERABLE (file/module) to verify its primary architectural role:
     - Dependency direction (e.g., "models must not import from controllers")
     - Separation of concerns (e.g., "business logic must not exist in route handlers")
     - Correct abstraction boundaries (e.g., "database access only through service layer")
  Structural ACs should catch the most likely honest mistakes. Do NOT over-engineer checks to guard against every theoretical bypass.
  3. QUALITY GATE ACs: Verify cross-cutting quality standards (if the evaluator role defines standard quality gates). These typically include:
     - Boundary safety: numeric conversion handles NaN and falsy edge cases
     - Test coverage: each feature has at least one error-path test, not just happy-path
     - Shared type hygiene: types imported by 3+ files are defined in dedicated types files
     Quality Gate ACs use behavioral tests (bun test with edge case inputs) or structural checks (grep for anti-patterns).
  4. DESIGN ACs: Verify code quality against the design language (evaluator reads specified source files, judges against calibration examples). Each Design AC specifies:
     - Which files to review
     - Which design criterion to evaluate (referencing the Design Language)
     - A concrete pass/fail threshold
     Example: "DESIGN-AC-01: Error handling style — Review src/services/*.ts — Errors must be domain-specific types, not generic strings. Business functions must use Result<T,E> or typed errors, not bare try-catch for control flow."
     If no Design Language is provided, omit Design ACs.
```

替换为：

```typescript
- TWO categories of verification:
  1. BEHAVIORAL ACs [PREFLIGHT]: Verify WHAT the code does by running the project's own build, test, lint, and typecheck commands. Examples: make build, bun test, npx tsc --noEmit, eslint .
     - ONLY use commands that already exist in the project's toolchain (Makefile, package.json scripts, etc.)
     - Do NOT write custom grep, awk, sed, find, or wc commands to verify code structure or patterns
     - Leave the expected output EMPTY — the engine judges by exit code only (0 = PASS)
     - Each command must be deterministic, fast (< 60s), and require no LLM judgment
  2. DESIGN ACs: Evaluator reads specified source files and judges against concrete criteria. Each Design AC specifies:
     - Which files to review (exact paths or glob patterns)
     - What to check: one of STRUCTURE, QUALITY, or DESIGN criteria
     - A concrete pass/fail threshold
     Design ACs cover ALL of the following concerns:
     - **Structure**: dependency direction, separation of concerns, abstraction boundaries, module isolation
     - **Quality gates**: boundary safety (NaN/falsy defense), test coverage (error-path tests exist), shared type hygiene (types in dedicated files), test authenticity (tests execute real code paths)
     - **Design craft**: code quality against the Design Language calibration examples (if provided)
     Example: "DESIGN-01: Module isolation — Review src/services/*.ts, src/routes/*.ts — Services must not import from routes. Route handlers must delegate business logic to services, not implement it inline."
     Example: "DESIGN-02: Error path coverage — Review tests/**/*.test.ts — Each test file must include at least one test case for invalid/missing input, not just happy-path."
```

- [ ] **Step 2: 替换 PREFLIGHT TAGGING 段落**

将 `src/negotiator.ts:164-172` 从：

```typescript
PREFLIGHT TAGGING:
- Tag any BEHAVIORAL or STRUCTURAL AC with [PREFLIGHT] in the title if it meets ALL criteria:
  - Deterministic (same input → same output, no environment dependency)
  - Fast (< 60 seconds)
  - No LLM judgment required (pure command + expected output comparison)
  Typically: compilation checks (tsc --noEmit), test runners (bun test), lint commands.
  Example: **AC-01: TypeScript compiles** [PREFLIGHT]
  The engine runs [PREFLIGHT] ACs mechanically before invoking the evaluator. If any fail, the generator retries immediately without an evaluator round.
- Do NOT tag DESIGN ACs or subjective checks as [PREFLIGHT].
```

替换为：

```typescript
PREFLIGHT TAGGING:
- ALL Behavioral ACs are automatically [PREFLIGHT]. Tag them with [PREFLIGHT] in the title.
  Example: **AC-01: TypeScript compiles** [PREFLIGHT]
  The engine runs [PREFLIGHT] ACs mechanically before invoking the evaluator. If any fail, the generator retries immediately without an evaluator round.
- Do NOT tag DESIGN ACs as [PREFLIGHT]. DESIGN ACs require LLM judgment.
- NEVER write custom grep/awk/sed/find commands as [PREFLIGHT] ACs. If you need to verify code structure or patterns, write a DESIGN AC instead.
```

- [ ] **Step 3: 验证 contractFormat 其余部分不需要改动**

确认以下不变：
- `src/negotiator.ts:139-142`（AC 基本格式：description + shell command + expected output）保留
- `src/negotiator.ts:161`（环境无关约束）保留
- `src/negotiator.ts:174-178`（IMPORTANT 段：deterministic、exact-match、deliverables only）保留

- [ ] **Step 4: Commit**

```bash
git add src/negotiator.ts
git commit -m "refactor(negotiator): simplify AC types from 4 to 2 in Generator prompt

Replace BEHAVIORAL/STRUCTURAL/QUALITY GATE/DESIGN with BEHAVIORAL [PREFLIGHT]
(exit-code-only, project commands only) and DESIGN (covers structure + quality +
design, evaluated by LLM). Ban custom grep/awk/sed in PREFLIGHT ACs."
```

---

## Task 2: 改造 Evaluator 合约审查指导（negotiator.ts）

**Files:**
- Modify: `src/negotiator.ts:275-298` — `buildEvaluatorPrompt` 的审查标准

**改动说明:** 移除"每个 deliverable 至少一个 structural AC"的硬性要求和 grep/find 相关审查标准，改为检查 DESIGN AC 对结构/质量的覆盖。

- [ ] **Step 1: 替换 Evaluator 审查标准**

将 `src/negotiator.ts:275-298` 从：

```typescript
Focus on the LATEST proposal. Review criteria (ONLY these — do not invent additional criteria):
- Does each AC have a CONCRETE shell command that can be executed as-is?
- Is the expected output DETERMINISTIC (exact string match, not dependent on environment)?
- Does the proposal cover ALL features described in the feature spec?
- Are the deliverables complete for the stated features?
- If this is a revision, were ALL previous feedback items addressed?
- Does each AC that verifies an API response include the EXACT expected JSON structure/shape?
  - BAD: "returns nodes" or "returns a list" (ambiguous — the generator may choose a different wrapper)
  - GOOD: Expected output shows exact JSON like [{"id":"..."}] or {"items":[...]}
- Are response format conventions (array vs object wrapper, field names, case conventions) consistent across all ACs?
- STRUCTURAL COVERAGE: Each deliverable (file/module) listed in the proposal must have at least one structural AC (grep/find) that verifies its primary architectural role. A structural AC is sufficient if it catches the most likely honest mistake -- do NOT evaluate against adversarial or deliberately deceptive implementations.
${designReviewCriteria}
REVISE only for execution-blocking issues:
- A verification command that won't run or produces non-deterministic output
- A feature from the feature spec with no corresponding AC
- Ambiguous expected output that can't be compared programmatically
- API response format that is ambiguous or inconsistent across ACs
- A deliverable with zero structural ACs -- every listed deliverable must have at least one structural check
${designReviseCriteria}
Do NOT request revisions for:
- Additional edge cases beyond what the feature spec requires
- Stylistic preferences on how ACs are written
- Suggestions for "nice to have" tests
- Theoretical adversarial implementations: do NOT REVISE because a deliberately deceptive generator could bypass a grep check. Structural ACs catch honest mistakes, not adversarial exploits
```

替换为：

```typescript
Focus on the LATEST proposal. Review criteria (ONLY these — do not invent additional criteria):
- Does each [PREFLIGHT] AC use ONLY project-existing commands (build/test/lint/typecheck)? If it contains custom grep/awk/sed/find commands, REVISE — these must be converted to DESIGN ACs.
- Is the expected output for [PREFLIGHT] ACs EMPTY (exit-code-only)? If a [PREFLIGHT] AC specifies expected stdout content, REVISE — remove the expected output or convert to a DESIGN AC.
- Does the proposal cover ALL features described in the feature spec?
- Are the deliverables complete for the stated features?
- If this is a revision, were ALL previous feedback items addressed?
- DESIGN AC COVERAGE: Each deliverable must be covered by at least one DESIGN AC that specifies:
  - Exact files to review
  - A concrete check (structure, quality gate, or design criterion)
  - A clear pass/fail threshold (not vague "review for quality")
  DESIGN ACs with vague criteria like "check code quality" or "review structure" are insufficient — REVISE.
${designReviewCriteria}
REVISE only for execution-blocking issues:
- A [PREFLIGHT] AC that uses custom grep/awk/sed instead of project toolchain commands
- A [PREFLIGHT] AC that specifies expected stdout (must be exit-code-only)
- A feature from the feature spec with no corresponding AC
- A deliverable with no DESIGN AC coverage (structure/quality/design)
- DESIGN ACs with vague criteria that cannot be objectively judged
${designReviseCriteria}
Do NOT request revisions for:
- Additional edge cases beyond what the feature spec requires
- Stylistic preferences on how ACs are written
- Suggestions for "nice to have" tests
```

- [ ] **Step 2: 移除 designReviewCriteria 和 designReviseCriteria 中过时的措辞**

检查 `src/negotiator.ts:247-255`。这两个变量现在仍然合适——它们只要求"有 Design AC 验证 Design Language"，不涉及 structural/quality gate。**不需要改动**，确认即可。

- [ ] **Step 3: Commit**

```bash
git add src/negotiator.ts
git commit -m "refactor(negotiator): update Evaluator review criteria for 2-type AC system

Remove 'structural coverage' requirement (grep/find per deliverable).
Add checks: PREFLIGHT must use project commands only with empty expected,
DESIGN ACs must have concrete criteria per deliverable."
```

---

## Task 3: 更新运行期 Generator prompt（sprint-executor.ts）

**Files:**
- Modify: `src/sprint-executor.ts:421-428` — 初次实现 workflow
- Modify: `src/sprint-executor.ts:373-385` — 设计重试 workflow
- Modify: `src/sprint-executor.ts:396-412` — 失败重试 workflow

**改动说明:** 运行期 Generator prompt 的 workflow 步骤引用了"structural ACs"，需要统一为新的 2 类术语。改动很小——主要是措辞调整。

- [ ] **Step 1: 更新初次实现 workflow**

将 `src/sprint-executor.ts:421-428` 从：

```typescript
## Workflow
1. Read the contract -- understand every AC and deliverable
2. Implement all deliverables listed in the contract
3. Self-verify: run each verification command, compare with expected output
4. Fix any mismatches found in step 3
5. Repeat steps 3-4 until all ACs pass
6. Self-review: re-read your code against the Design Language (if provided). If any code matches the ⚠️ (minimum acceptable) level rather than the ✅ (target) level, refactor it now -- before the evaluator sees it
7. Git commit your changes
```

替换为：

```typescript
## Workflow
1. Read the contract -- understand every AC and deliverable
2. Implement all deliverables listed in the contract
3. Self-verify: run each [PREFLIGHT] command, confirm exit code 0
4. Fix any failures found in step 3
5. Repeat steps 3-4 until all [PREFLIGHT] ACs pass
6. Self-review against DESIGN ACs: for each DESIGN AC, read the specified files and verify against the stated criteria. If any code fails the criteria, fix it now
7. Self-review: re-read your code against the Design Language (if provided). If any code matches the ⚠️ (minimum acceptable) level rather than the ✅ (target) level, refactor it now -- before the evaluator sees it
8. Git commit your changes
```

- [ ] **Step 2: 更新设计重试 workflow**

将 `src/sprint-executor.ts:381-384` 从：

```typescript
## Workflow
1. Read the Design Review Feedback -- understand each DESIGN: failure
2. Refactor the identified code to match the Design Language above
3. Do NOT change any functional logic
4. Self-verify: re-run ALL ACs (behavioral + structural) to confirm no regressions
5. Git commit your changes
```

替换为：

```typescript
## Workflow
1. Read the Design Review Feedback -- understand each DESIGN: failure
2. Refactor the identified code to match the Design Language above
3. Do NOT change any functional logic
4. Self-verify: re-run ALL [PREFLIGHT] ACs to confirm no regressions
5. Git commit your changes
```

- [ ] **Step 3: 更新失败重试 workflow**

确认 `src/sprint-executor.ts:403-409` 的 workflow 不引用具体 AC 类型名称（它使用"failing ACs"和"previously passing ACs"的泛称），**不需要改动**。

- [ ] **Step 4: Commit**

```bash
git add src/sprint-executor.ts
git commit -m "refactor(sprint-executor): align runtime prompts with 2-type AC system

Update workflow steps to reference [PREFLIGHT] (exit-code) and DESIGN ACs
instead of behavioral/structural categories."
```

---

## Task 4: 更新 Evaluator 运行期 prompt（sprint-executor.ts）

**Files:**
- Modify: `src/sprint-executor.ts:491-533` — attempt 1 评估指令
- Modify: `src/sprint-executor.ts:524-529` — Cross-File Consistency Check

**改动说明:** Evaluator 运行期 prompt 中的 Cross-File Consistency Check 段落当前是硬编码的。改造后这些检查由 DESIGN AC 覆盖，但作为 Evaluator 的兜底审查仍应保留。主要需要确认措辞一致性。

- [ ] **Step 1: 确认 attempt 1 评估指令兼容新体系**

审查 `src/sprint-executor.ts:507-541`。关键段落：
- Part 1 "Run each AC's verification command" → 仍适用于 [PREFLIGHT] AC
- Part 2 "Source Code Review" → 仍适用于 DESIGN AC 的审查
- Part 2b "Cross-File Consistency Check" → 保留作为兜底，但原文中 shared type 检查现已由 DESIGN AC 覆盖

Part 2b `src/sprint-executor.ts:524-529` 不需要修改——它是 Evaluator 的独立审查逻辑，不依赖合约中的 AC 类型命名。**确认无需改动。**

- [ ] **Step 2: 确认 attempt 2+ prompt 兼容**

审查 `src/sprint-executor.ts:548-555`。这段使用 "previously failed items" 泛称，不引用具体 AC 类型。**确认无需改动。**

- [ ] **Step 3: Commit（如有改动）或跳过**

如果 Step 1-2 确认无需改动，跳过此 commit。否则：

```bash
git add src/sprint-executor.ts
git commit -m "refactor(sprint-executor): align Evaluator runtime prompt with 2-type AC system"
```

---

## Task 5: 改造 Phase 2 Skill 模板（phase-2-workspace.md）

**Files:**
- Modify: `.claude/skills/loom/phase-2-workspace.md:130-131` — Generator 协商职责
- Modify: `.claude/skills/loom/phase-2-workspace.md:166-218` — Evaluator 标准质量门 + 评判标准 + 协商职责

**改动说明:** 这是改动量最大的文件。QG-1~QG-4 从独立的"标准质量门"section 合并到 Evaluator 的"评判标准"中作为 DESIGN AC checklist，Generator 协商职责加入 PREFLIGHT 标记规则，Evaluator 协商职责加入禁止 grep AC 规则。

- [ ] **Step 1: 更新 Generator 模板的协商职责**

将 `.claude/skills/loom/phase-2-workspace.md:130-131` 从：

```markdown
## 协商职责
[合约协商阶段如何提出 AC 和验证命令]
```

替换为：

```markdown
## 协商职责
[合约协商阶段如何提出 AC 和验证命令]

### PREFLIGHT AC 规则
- 只使用项目已有的 build/test/lint/typecheck 命令
- expected output 留空（引擎靠 exit code 判定，0 = PASS）
- 禁止自制 grep/awk/sed/find 命令——如需验证代码结构或模式，写 DESIGN AC
- 例：make build、bun test、npx tsc --noEmit

### DESIGN AC 规则
- 覆盖代码结构、质量门、设计品质的全部关切
- 每条 DESIGN AC 必须指定：审查文件集 + 具体检查项 + 明确 pass/fail 条件
- 禁止写泛化描述（如"审查代码质量"）
```

- [ ] **Step 2: 将 QG-1~QG-4 合并到评判标准的 DESIGN AC checklist**

将 `.claude/skills/loom/phase-2-workspace.md:166-217` 从：

```markdown
## 标准质量门

合约协商阶段，以下质量门必须转化为 AC 纳入合约：

### QG-1: 边界值安全
接受外部输入的函数，数值转换必须防御 NaN 和 falsy 陷阱。
协商时：为每个接受数值参数的端点/命令，增加一个 invalid input 测试 AC。

### QG-2: 测试覆盖质量
测试不仅验证 happy path，还必须验证至少一个 error path。
协商时：确保测试 AC 要求 "test file exists AND passes"，同时至少有一个测试用例
验证 invalid/missing input 的行为。

### QG-3: 共享类型归属
被多个文件 import 的类型必须在独立 types 文件中定义。
协商时：增加 structural AC 验证共享类型不寄生在实现文件中。

### QG-4: 测试真实性
测试必须真正执行被测代码路径，不能只验证 "功能关键词存在于测试文件中"。
协商时：行为 AC 验证测试通过（exit code 0），不用 grep 验证测试文件内容。

...（评估纪律、严格程度、协商职责部分）...
```

替换为：

```markdown
## DESIGN AC 必覆盖项（质量门）

合约协商阶段，以下质量关切必须作为 DESIGN AC 纳入合约（不是 PREFLIGHT，由 Evaluator 读代码判定）：

### 边界值安全
接受外部输入的函数，数值转换必须防御 NaN 和 falsy 陷阱。
DESIGN AC 示例："Review src/handlers/*.ts — 每个接受数值参数的函数必须有显式的 NaN/falsy 防御，不能裸用 Number() 或 parseInt() 而不检查返回值"

### 测试覆盖质量
测试不仅验证 happy path，还必须验证至少一个 error path。
DESIGN AC 示例："Review tests/**/*.test.ts — 每个测试文件必须包含至少一个验证 invalid/missing input 行为的测试用例"

### 共享类型归属
被 3+ 文件 import 的类型必须在独立 types 文件中定义。
DESIGN AC 示例："Review src/**/*.ts — 任何被 3 个以上文件 import 的 interface/type 必须定义在 types.ts 或 types/ 目录中，不得寄生在实现文件"

### 测试真实性
测试必须真正执行被测代码路径，不能只验证模式存在。
DESIGN AC 示例："Review tests/**/*.test.ts — 测试必须 import 并调用被测函数，不能只用 mock 替代全部逻辑"

...（评估纪律部分不变）...
```

- [ ] **Step 3: 更新严格程度表**

将 `.claude/skills/loom/phase-2-workspace.md:209-213` 从：

```markdown
## 严格程度
| 硬性 → FAIL | stub、功能不工作、测试/构建失败、安全漏洞、博弈实现 |
| 硬性 → FAIL | 标准质量门（QG-1 到 QG-4）不满足 |
| CRITICAL → FAIL | 超出 AC 但发现静默正确性问题 |
| 软性 → 📝 NOTE | 命名偏好、非关键注释、⚠️ 及格水平代码（首次评估） |
| 不验证 | 性能（除非 spec 要求）、代码风格偏好 |
```

替换为：

```markdown
## 严格程度
| 硬性 → FAIL | stub、功能不工作、测试/构建失败、安全漏洞、博弈实现 |
| 硬性 → FAIL | DESIGN AC 不满足（结构、质量门、设计品质） |
| CRITICAL → FAIL | 超出 AC 但发现静默正确性问题 |
| 软性 → 📝 NOTE | 命名偏好、非关键注释、⚠️ 及格水平代码（首次评估） |
| 不验证 | 性能（除非 spec 要求）、代码风格偏好 |
```

- [ ] **Step 4: 更新 Evaluator 协商职责**

将 `.claude/skills/loom/phase-2-workspace.md:215-217` 从：

```markdown
## 协商职责
[审查合约提案时的标准：命令可执行、输出确定性、spec 覆盖完整、实现可区分]
协商时额外检查：标准质量门是否已转化为具体 AC
```

替换为：

```markdown
## 协商职责
[审查合约提案时的标准：spec 覆盖完整、DESIGN AC 有具体文件集和 fail 条件]
协商时额外检查：
- [PREFLIGHT] AC 是否只用 build/test/lint/typecheck 命令（禁止 grep/awk/sed/find）
- [PREFLIGHT] AC 的 expected output 是否为空（exit-code-only）
- 发现自制 grep/awk/sed 验证命令 → 要求改为 DESIGN AC
- 质量门（边界安全、测试覆盖、类型归属、测试真实性）是否已转化为 DESIGN AC
```

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/loom/phase-2-workspace.md
git commit -m "refactor(phase-2-workspace): merge QG-1~4 into DESIGN AC checklist

Replace standalone 'Standard Quality Gates' section with 'DESIGN AC
Required Coverage' that uses DESIGN AC format (file set + criteria + threshold).
Add PREFLIGHT rules to Generator and grep-ban to Evaluator negotiation duties."
```

---

## Task 6: 端到端验证

**Files:**
- Read: all modified files

- [ ] **Step 1: 全文检索残留的旧术语**

```bash
grep -rn "STRUCTURAL AC\|QUALITY GATE AC\|structural AC\|quality gate" src/ .claude/skills/loom/phase-2-workspace.md
```

Expected: 无匹配（或只在注释/changelog 中出现）。如果在 prompt 文本中发现残留，修复。

- [ ] **Step 2: 检查 negotiator.ts 中 extractAcIds 的正则**

确认 `src/negotiator.ts:329-333` 的正则 `/AC-\d+|ARCH-\d+|DESIGN-\d+/` 仍然覆盖新的 DESIGN AC ID 格式（`DESIGN-01` 等）。**应该无需改动**——新格式使用 `DESIGN-01` 符合现有正则。

- [ ] **Step 3: 检查 parsePreflightACs 兼容性**

确认 `src/sprint-executor.ts:114-151` 的 parser 能正确处理 expected 为空的 PREFLIGHT AC（即没有 "Expected:" 段落的情况）。审查代码：line 135 `while (j < lines.length && !lines[j].toLowerCase().startsWith("expected")) j++;` 会一直扫到文件末尾，此时 expected 保持为空字符串。`runPreflight` line 161 `!ac.expected` 为 true → 自动 PASS。**兼容，无需改动。**

- [ ] **Step 4: TypeScript 编译检查**

```bash
cd /Users/pxy/Developer/loom && npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 5: 运行现有测试**

```bash
cd /Users/pxy/Developer/loom && bun test
```

Expected: 全部通过。

- [ ] **Step 6: Commit（如有修复）或确认完成**

如果 Step 1-5 发现问题并修复：

```bash
git add -A
git commit -m "fix: clean up stale AC type references after redesign"
```
