# Discussion — 2026-04-10 14:50

- **Topic**: Loom AC 验证机制改造方案合理性评估 — 将 4 类 AC 简化为 2 类（PREFLIGHT exit-code-only + DESIGN-AC 全覆盖）
- **Thread ID**: a43be8df397810d55

## State
- Round: 1
- Status: complete
- Last Completed Step: round-0-codex-recorded
- Pending Outbound: none
- Consensus: 方案方向正确，应执行；PREFLIGHT 限制为项目已有命令；DESIGN-AC 需结构化 checklist
- Open Disputes: (none — see below)
- Open Questions: (none)

---

## Claude 独立分析（Codex 启动前）

### Facts

1. **FACT**: `negotiator.ts:137-226` Generator prompt 定义 4 类 AC：BEHAVIORAL、STRUCTURAL、QUALITY GATE、DESIGN。其中 STRUCTURAL 要求每个 DELIVERABLE 至少一条，用 grep/find/ast-grep/wc 验证代码结构。
2. **FACT**: `sprint-executor.ts:162` preflight 验证逻辑为 `const passed = !ac.expected || actual.includes(ac.expected)`。expected 为空时自动 PASS（只看 exit code）。
3. **FACT**: `negotiator.ts:228-316` Evaluator prompt 要求 AC 命令"deterministic, exact string match, not environment-dependent"，但实际上 grep/awk 命令天然受 shell 环境影响。
4. **FACT**: `phase-2-workspace.md` 定义 QG-1~QG-4 标准质量门（边界安全、测试覆盖、类型卫生、测试真实性），这些在协商时被转化为 QUALITY GATE AC。
5. **FACT**: 改造方案中 `sprint-executor.ts` 的代码逻辑实际不需要改动，核心改动集中在 prompt 工程（negotiator.ts 的 Generator/Evaluator 指导）和 skill 模板（phase-2-workspace.md）。

### Main Thesis

**方案总体合理，核心原则正确（机器跑命令看 exit code，LLM 读代码判质量），但有 3 个需要评估的风险点：**

1. **结构验证的可靠性降级风险**（置信度：Medium）
   - 现状：STRUCTURAL AC 用 grep 机械验证"文件 A 是否 import 模块 B"、"目录结构是否符合约定"，虽然脆弱但在成功时是确定性的
   - 改后：全部交给 Evaluator LLM 判断，LLM 可能漏掉简单但重要的结构事实（如依赖方向违规）
   - 但考虑到 on-device-gemma 案例中这些 grep 命令频繁误判，"确定性但经常错"不如"概率性但大概率对"

2. **Evaluator 认知负载增加**（置信度：Medium）
   - DESIGN-AC 原本只审查设计品质，现在要额外覆盖结构合规 + 编码规范 + QG-1~QG-4
   - 单次 Evaluator 调用的 prompt 会变长，可能影响审查深度
   - 但这可以通过更结构化的 DESIGN-AC 模板来缓解

3. **改动范围实际很小，风险可控**（置信度：High）
   - 核心代码（sprint-executor.ts）不需要改
   - 主要是 prompt 文本调整，可以渐进式部署
   - 向后兼容：已有的带 expected 的 AC 仍然可以工作（includes 逻辑保留）

### Alternative Hypotheses

1. **中间路线**：保留 STRUCTURAL AC 类型，但限制只能用项目已有的 lint/check 工具（如 `eslint --rule no-restricted-imports`），而不是自制 grep。这样保留了机械验证的确定性，又避免了自制脚本的脆弱性。
2. **增强而非替换**：给 sprint-executor 加一个 shell 标准化层（统一 bash、strip ANSI codes、normalize whitespace），而不是放弃 stdout 匹配。

### Likely Weak Assumptions

- **假设 Evaluator LLM 能可靠地完成结构审查**：如果 Evaluator 在高负载下遗漏关键结构问题，可能比现在的"grep 误判"更难发现（grep 至少会报 FAIL，Evaluator 可能假阳性 PASS）
- **假设 PREFLIGHT 只需要 build/test/lint**：某些项目可能有非标准的验证需求（如 API 兼容性检查），完全禁止自制命令可能过于严格

### 我的 Best Guess

**方案应该执行，但建议两个调整：**
1. DESIGN-AC 模板需要结构化的 checklist（不是自由文本），强制 Evaluator 逐项检查结构+规范+设计
2. 对 PREFLIGHT 的"禁止自制命令"规则，改为"禁止依赖 stdout 内容匹配的自制命令"——允许 expected 为空的自制命令（纯 exit code 判定）

**置信度：Medium-High** — 核心方向正确，细节可能需要迭代。

---

## Round 0 — Codex 独立分析

### 总体判断
方案方向正确，但不是零风险简化。

### Facts (Codex 引用)
1. **FACT**: `sprint-executor.ts:154-173` — 引擎的 PREFLIGHT 执行器只是 `execSync()` + `stdout.includes(expected)` 的薄封装，没有健壮的 shell 验证层
2. **FACT**: `negotiator.ts:285-293` — Evaluator prompt 要求"每个 deliverable 至少一个 structural AC"，移除后失去硬覆盖门槛
3. **FACT**: `negotiator.ts:164-172` — Generator prompt 已有"先抽取项目工具链"的方向
4. **FACT**: `phase-2-workspace.md:142-218` — QG-3 明确要求 structural AC，与提案正面冲突
5. **FACT**: `parsePreflightACs()` 天然支持 expected 为空时只看 exit code，不需要代码改动

### Main Thesis
采纳提案，但保留极受限的机械层（只跑仓库已有 build/test/lint/typecheck 命令），DESIGN-AC 必须按"文件集合 + 明确 fail 条件"来写，不能泛化为"审一下结构"。

### Risks
1. **半迁移风险**（最大）：如果只改 Generator 侧而不同步改 Evaluator 协商标准和 Phase 2 模板，系统会继续要求 structural AC，导致协商来回打架
2. **假阳性 PASS 风险**：移除 structural AC 后，"类型定义寄生在实现文件"、"模块越层 import"等机械性问题可能被 Evaluator 遗漏
3. **Evaluator 不会被压垮**：它已经在做 design review、cross-file consistency check、QG-1~QG-4 审查

### Alternative
- "加 shell normalization 层"不是更好方向——会把脆弱问题升级成运行时兼容层工程
- 保留 PREFLIGHT 但只允许项目已有命令，禁止自由拼装 grep/awk/sed

### 迁移路径
最少需要同步改 4 处语义来源：
1. Generator 协商 prompt (`negotiator.ts:137-178`)
2. Evaluator 协商 prompt (`negotiator.ts:275-299`)
3. 运行期 Generator/Evaluator prompt (`sprint-executor.ts:373-385, 421-428, 548-555`)
4. Phase 2 role 模板 (`phase-2-workspace.md:142-218`)

---

## 讨论总结

### Claude 与 Codex 共识（无争议）

| # | 共识点 | Claude 证据 | Codex 证据 |
|---|--------|------------|------------|
| 1 | **方案方向正确**：4→2 类 AC 简化合理 | 根因分析正确：LLM 写 shell 脚本做代码分析机制本身脆弱 | `sprint-executor.ts:154-173` 证实引擎无健壮 shell 层 |
| 2 | **PREFLIGHT 只用项目已有命令**，禁止自制 grep/awk/sed | Claude 提出"禁止依赖 stdout 匹配的自制命令" | Codex 提出"只允许仓库已有 build/test/lint/typecheck" |
| 3 | **DESIGN-AC 需要结构化 checklist**，不能泛化 | Claude: "强制逐项检查结构+规范+设计" | Codex: "按文件集合 + 明确 fail 条件" |
| 4 | **假阳性 PASS 风险真实存在**但可管理 | grep 成功时有确定性优势 | 移除后失去 `negotiator.ts:285-293` 的硬覆盖门槛 |
| 5 | **sprint-executor.ts 基本不需要改** | `!ac.expected` 为 true 时直接 PASS | `parsePreflightACs()` 天然支持 |
| 6 | **Shell normalization 层不是好替代方案** | Claude 列为 Alternative 但未推荐 | Codex 明确反对："升级为运行时兼容层工程" |
| 7 | **迁移必须同步改 4 处**，半迁移是最大风险 | Claude 未显式列出但认可改动范围 | Codex 明确列出 4 处语义来源 |

### 双方一致的建议

1. **执行方案**，核心原则"机器看 exit code，LLM 读代码判质量"正确
2. **PREFLIGHT 规则微调**：不是"完全禁止自制命令"，而是"禁止依赖 stdout 匹配"。允许 expected 为空的自定义命令（纯 exit code）
3. **DESIGN-AC 模板强化**：必须写成"审查文件集 + 具体 fail 条件"的 checklist，不能写成开放式审美判断
4. **迁移要原子化**：negotiator.ts (Generator + Evaluator) + sprint-executor.ts (运行期 prompt) + phase-2-workspace.md 必须同步改，避免半迁移导致协商死循环

### Action Items

- [ ] 改 `negotiator.ts` Generator prompt：2 类 AC 指导 + 禁止 stdout 匹配的自制命令
- [ ] 改 `negotiator.ts` Evaluator prompt：移除"每个 deliverable 至少一个 structural AC"要求，改为 DESIGN-AC 覆盖检查
- [ ] 改 `sprint-executor.ts` 运行期 prompt（373-385, 421-428, 548-555）
- [ ] 改 `phase-2-workspace.md`：QG-1~QG-4 合并到 DESIGN-AC checklist 模板，移除 QG-3 对 structural AC 的硬性要求
- [ ] DESIGN-AC 模板格式：每条 AC 必须指定 `审查文件集` + `具体 fail 条件`（不允许泛化描述）
