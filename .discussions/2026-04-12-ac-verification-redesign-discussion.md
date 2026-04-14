# Discussion — 2026-04-12 14:00

- **Topic**: Loom AC 验证机制改造方案的改进空间
- **Thread ID**: 019d809a-fb37-7f81-9a60-97f56d821196

## State
- Round: 1
- Status: complete
- Last Completed Step: implemented
- Pending Outbound: none
- Consensus: 
  - C1: 核心洞察正确（LLM 写 shell 脚本做验证本身脆弱）
  - C2: sprint-executor.ts:161 的 runPreflight 不需要改代码
  - C3: 一刀切禁所有 structural shell verification 过于激进
  - C4: QG-1/QG-2/QG-4 本质是行为约束（测试），不是 grep 检查
- Open Disputes: 
  - D1: 中间方案的具体形式（allowlist verifier vs 只禁 pipeline/重定向）
  - D2: QG 保留为独立结构还是并入 DESIGN-AC
- Open Questions:
  - Q1: 缺少 false fail 根因分布数据
  - Q2: ast-grep 在 clean checkout 中是否稳定可用
  - Q3: attempt 2+ 不做开放式审查的漏检风险

---

## Claude 独立分析（Codex 启动前）

### Facts
- **FACT-1**: `negotiator.ts:137-178` 定义了 4 类 AC：BEHAVIORAL, STRUCTURAL, QUALITY GATE, DESIGN（file: src/negotiator.ts:143-159）
- **FACT-2**: `sprint-executor.ts:161` 的 preflight 逻辑已经兼容 expected 为空的情况：`const passed = !ac.expected || actual.includes(ac.expected)`，expected 为空时 `!ac.expected` 为 true，直接 PASS，只看 exit code（file: src/sprint-executor.ts:161）
- **FACT-3**: Evaluator prompt 已经很长（约 50 行 review criteria + design review instructions），当前的 STRUCTURAL COVERAGE 检查只占 2 行（file: src/negotiator.ts:285, 292）
- **FACT-4**: `phase-2-workspace.md:166-185` 定义了 QG-1~QG-4，每个 QG 在协商阶段有明确的"协商时"指令，要求 Evaluator 在审查合约时确保这些 AC 被纳入（file: .claude/skills/loom/phase-2-workspace.md:170-185）
- **FACT-5**: 方案文档引用的实际案例（on-device-gemma Sprint 02）中，AC-01 失败原因是 `tail -1` 在非 TTY 下拿到错误行，AC-19 失败原因是 `grep -c` 的 exit code 和 zsh `$(())` 的交互问题

### Main Thesis
方案的核心洞察正确：LLM 不擅长写跨 shell 健壮的验证脚本。但改造方案可能矫枉过正，有以下改进空间：

1. **不是所有 shell 验证都脆弱** — 区分"项目工具链命令"（make build, bun test, tsc --noEmit）和"自制验证脚本"（grep | awk | sed 管道），只禁后者
2. **DESIGN-AC 负担过重风险** — 把 STRUCTURAL + QUALITY GATE 的所有关切塞进 DESIGN-AC，Evaluator prompt 膨胀，可能导致注意力稀释
3. **QG 从协商转移到评估的约束力下降** — 原来 QG 在协商阶段由 Evaluator 显式检查合约是否包含对应 AC，改为纯靠 Evaluator 读代码时记得检查，结构化约束变成了隐性期望
4. **可能的中间方案** — 保留简单、可靠的 structural check（如 `grep -rL` 检查文件存在性），只禁复杂的 stdout 解析管道

### Confidence
- 核心洞察（禁 LLM 写 shell 脚本）：High
- DESIGN-AC 负担过重的担忧：Medium（需要看实际 Evaluator 表现）
- QG 约束力下降的担忧：Medium-High（从结构化检查变成隐性期望是明确的退步）
- 中间方案的可行性：Medium（需要定义"简单可靠"的边界）

---

## Round 0 — Codex 初始分析

### Facts
- FACT: Generator prompt 要求每个 AC 有精确 shell 命令和精确匹配的 expected stdout（src/negotiator.ts:141-142, 145, 149）
- FACT: Evaluator 把"每个 deliverable 都必须有 structural AC"当成修订硬条件（src/negotiator.ts:285, 292, 298）
- FACT: runPreflight() 已支持 exit-code-only 语义（src/sprint-executor.ts:158, 161, 164）
- FACT: attempt 1 Evaluator 已硬编码 cross-file consistency check（shared type location, pattern consistency, import hygiene）（src/sprint-executor.ts:521-530）
- FACT: attempt 2+ 明确禁止新的开放式 source review（src/sprint-executor.ts:548, 553-554）
- FACT: QG-1/QG-2/QG-4 偏向测试/行为验证，只有 QG-3 明确要求 structural AC（phase-2-workspace.md:170-185）
- FACT: 提案失败案例都是 shell 管道/输出匹配问题（ac-verification-redesign.md:11-12）

### Main Thesis
- 提案抓到了真实故障源，但一刀切禁所有 structural shell verification 过度
- 把所有 structural + QG 负担压到 DESIGN-AC 会提高漏检风险（attempt 2+ 不做新审查）
- 去掉 QG-1~QG-4 作为显式协商结构是回归
- QG-1/QG-2/QG-4 不是 grep 检查，不应该和 STRUCTURAL AC 一起被砍
- 更稳的方向：机械层收窄并类型化（exit-code build/test/lint + 小 allowlist structural verifier），QG 保持显式 checklist

### Alternative Hypotheses
- 主因可能不是 structural shell 本身，而是 prompt 强迫 LLM 生成"精确 stdout 匹配"
- 真正该禁的是"LLM 自由编写的 ad hoc shell pipelines"，不是所有 shell structural checks
- runtime evaluator 硬编码的 cross-file checks 可能部分补偿 QG 损失

### What Claude Should Verify
- 统计 false fail 根因分布
- 做 A/B 回放对比
- 核查 QG-1~QG-4 的实际拦截价值
- 检查 attempt 2+ 漏检风险
- 验证 verifier schema 可行性（build | test | lint | ast_query | grep_literal，禁管道/重定向/命令替换）

### Confidence: Medium
