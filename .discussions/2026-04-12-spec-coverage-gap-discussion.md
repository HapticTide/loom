# Discussion — 2026-04-12 19:30

- **Topic**: 修复 loom 协商阶段 spec 覆盖率不足导致最终交付遗留大量 Known Limitations
- **Thread ID**: 019d8148-2a06-7601-af85-d49de5be648a

## State
- Round: 0
- Status: complete
- Last Completed Step: round-0-codex-recorded
- Pending Outbound: none
- Consensus:
  - C1: 主修复必须在协商阶段（合约定稿后实现 Generator 只按合约做事，不会回到协商）
  - C2: "cover ALL features" 是愿望不是约束，需要 spec-to-AC 显式映射
  - C3: Round 2+ Generator 看不到原始 spec（negotiator.ts:208），这是结构性缺陷
  - C4: Round 3+ Evaluator 有 focused review 收窄审查范围，会进一步遗漏
  - C5: 实现阶段兜底有用但不够（只有 attempt 1 能做 critical scan，且不会触发重新协商）
- Open Disputes: none
- Open Questions:
  - Q1: 漏项是 Round 1 就缺还是后续修订丢的（需查 contract-negotiation.md）

---

## Claude 独立分析（Codex 启动前）

### Facts
- **FACT-1**: negotiator.ts:280 Evaluator 审查标准第一条就是 "Does the proposal cover ALL features described in the feature spec?" — 机制已存在
- **FACT-2**: negotiator.ts:297 REVISE 原因里包含 "A feature from the feature spec with no corresponding AC" — 机制已存在
- **FACT-3**: sprint-executor.ts:530-532 实现阶段 Evaluator 有 "Critical Observation Scan"：发现 spec 意图被违反时标 CRITICAL: FAIL — 但实际案例中被标为 NOTE
- **FACT-4**: ASM sprint-05 eval report：Evaluator 发现 theme toggle 缺失，但判为 NOTE 理由是"not covered by any specific AC in the contract"
- **FACT-5**: Paseo sprint-03 eval report：Evaluator 发现 effectiveRoot 缺失和 monospace font 缺失，判为 NOTE 理由是"contract ACs 未对此设置验证条件"
- **FACT-6**: negotiator.ts:304 明确说 "Do NOT request revisions for: Additional edge cases beyond what the feature spec requires" — 但问题不是 edge case，而是 spec 明确要求的功能

### Root Cause Chain
问题链条有 3 个失效点：

1. **协商阶段 Generator 丢 spec 细节** — Generator 把"theme toggle"、"effectiveRoot"等 spec 明确要求的功能在写合约时遗漏了
2. **协商阶段 Evaluator 没拦住** — 虽然 prompt 说 "cover ALL features"，但 LLM 把"ALL"理解为"主要功能"，细节特性被当作 edge case 跳过
3. **实现阶段 Evaluator 降级为 NOTE** — Critical Scan 发现了问题，但因为"合约里没有"就不标 FAIL

### Main Thesis
修复应该双管齐下：

**A. 协商阶段：强制 spec-to-AC 映射（主修）**
- 要求 Evaluator 在审查合约时，显式列出 spec 中的每个功能点，逐一确认是否有对应 AC
- 不是模糊地问"cover ALL features"，而是要求 "enumerate every feature/requirement from the spec and verify each one maps to at least one AC"
- 缺少映射 → REVISE

**B. 实现阶段：CRITICAL scan 升级为 FAIL（辅修）**
- 当 Evaluator 在 Critical Scan 中发现 spec 明确要求但实现缺失的功能时，不应该因为"合约没有"就降级为 NOTE
- 合约遗漏是协商的 bug，不应该成为实现阶段放行的理由
- 但这是兜底，不是主要修复点

### Confidence
- Root cause chain: High（有两个项目的实际证据）
- 方案 A 有效性: Medium-High（结构化要求比模糊指令更可靠，但 LLM 仍可能遗漏）
- 方案 B 有效性: Medium（兜底有用，但如果合约就没覆盖，Generator 也不会实现这些功能）
- 方案 B 的风险: Medium（可能导致过度 FAIL — spec 里有些描述性文字不是硬性要求）
