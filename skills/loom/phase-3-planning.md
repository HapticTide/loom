# Phase 3: Sprint 规划

## 目标

将 `spec.md` 分解为有序的、可独立验证的 Sprint，每个 Sprint 产出可运行的增量。

## 输入 / 输出

- **输入**: `.loom/<task>/spec.md`、`.loom/<task>/generator.md`、`.loom/<task>/evaluator.md`
- **输出**: `.loom/<task>/project-plan.md`、`.loom/<task>/sprint-XX/feature-spec.md`

## 协作模式

**半交互** — 生成计划后可选用户审核。简单项目直接推进，复杂项目建议确认。

---

## 核心原则

### Sprint 是可选假设

> "Every component in a harness encodes an assumption about what the model can't do on its own, and those assumptions are worth stress testing." — Anthropic

功能模块 ≤ 3 且无复杂依赖 → 考虑单 Sprint。不确定时倾向**更少的 Sprint**——减少编排开销。

### Feature Spec 只描述 What，不描述 How to Verify

验收标准 (AC) 由 Generator↔Evaluator 在合约协商阶段决定。**不要在 Feature Spec 中写 AC、测试命令或预期输出。**

---

## 步骤

### 1. 评估是否需要分解

| 复杂度 | 功能模块数 | 建议 Sprint 数 |
|--------|-----------|---------------|
| 简单 | < 5 | 1-2 |
| 中等 | 5-15 | 3-5 |
| 复杂 | > 15 | 5-10 |

### 2. 拆分策略

- **按功能模块拆分，不按技术层**
  ```
  ❌ Sprint 1: 数据库层 → Sprint 2: API 层 → Sprint 3: UI 层
  ✅ Sprint 1: 骨架 → Sprint 2: 用户认证(全栈) → Sprint 3: 产品管理(全栈)
  ```
- **第一个 Sprint 永远是基础设施**: 项目骨架、核心抽象、开发工具链
- **每个 Sprint 可独立运行和验证**。无法独立验证的功能合并到上一个 Sprint
- **依赖关系线性或 DAG**，不能循环

### 3. 编写 `project-plan.md`

```markdown
# Project Plan: [项目名称]

## Sprint 01: [标题]
- 目标: [一句话]
- 模块: [涉及的 spec 功能模块]
- 依赖: 无

## Sprint 02: [标题]
- 目标: [一句话]
- 模块: [涉及的 spec 功能模块]
- 依赖: Sprint 01
```

### 4. 为每个 Sprint 创建 `feature-spec.md`

```markdown
# Sprint XX: [标题]

## 功能描述
[2-3 段。提供足够上下文让 Generator 不需要回看 spec.md。]

## 用户故事
- 作为 [角色]，我希望 [功能]，以便 [价值]

## 技术方向
- [方向性指引，不是实现方案]

## 交付物
- [file1.ts] — [说明]
- [file2.ts] — [说明]

## 依赖
- [前置 Sprint，如有]
- [如果依赖前序 Sprint 的具体接口，列出假设存在的端点/函数/文件]
  例如：假设 Sprint 01 提供 GET /api/v1/nodes, POST /api/v1/users 等端点
```

**不写 AC / 测试命令 / 预期输出** — 由合约协商阶段决定。

**跨 Sprint 接口依赖**: 如果 Sprint N+1 调用 Sprint N 创建的接口（API 端点、service 函数、CLI 命令），必须在依赖节**明确列出假设存在的接口清单**。不能只写「依赖 Sprint 01」——要写「假设 Sprint 01 提供了 GET /api/v1/nodes、POST /api/v1/users 等端点」。合约协商时 Evaluator 会对照 context.md 中记录的前序 Sprint 交付物进行校验。

---

## 退出条件

- [ ] Sprint 分解的必要性已评估（不是机械拆分）
- [ ] 每个 Sprint 可独立构建和验证
- [ ] Sprint 间依赖明确且无循环
- [ ] Feature Spec 不包含 AC 或测试命令
- [ ] `project-plan.md` 覆盖 spec.md 所有功能模块

完成后 → **Phase 4: 执行交付**
