---
name: loom
description: >
  Autonomous multi-agent implementation for complex features.
  Use when: building multi-file features, new projects from scratch,
  tasks needing architecture + implementation + QA verification.
  NOT for: single-file bugs, config tweaks, code explanations, small refactors.
argument-hint: "[task-description]"
---

# loom — 自主多 Agent 实现

**你**（宿主 Agent）驱动 Phase 1-3（需求、工作区、规划），然后调用 `loom` CLI 执行 Phase 4（自主实现+验证循环）。Loom 通过子进程调用无头 Coding Agent，无需 SDK。

**对用户透明**: 不要暴露内部机制（sprint、合约、协商）。用自然语言描述进展。

## 存储架构

Loom 使用**集中式存储**：所有数据存放在 `~/.loom/projects/<project-name>/<task>/`。
项目目录下的 `.loom` 是一个**软链接**指向 `~/.loom/projects/<project-name>/`，因此 `.loom/<task>/` 等价于真实路径。

本文档中 `.loom/<task>/` 均指通过软链接访问的路径。

## 工作流

检测 `.loom/<task>/` 的当前状态，从断点阶段继续。

| 阶段 | 谁执行 | 目标 | 协作模式 | 指南 |
|------|--------|------|----------|------|
| Phase 1 | **你** | 用户意图 → `spec.md` | 交互式 | [phase-1-spec.md](phase-1-spec.md) |
| Phase 2 | **你** | spec → `design-language.md` + `generator.md` + `evaluator.md` | 自主 | [phase-2-workspace.md](phase-2-workspace.md) |
| Phase 3 | **你** | spec → sprint 目录 + `feature-spec.md` | 半交互 | [phase-3-planning.md](phase-3-planning.md) |
| Phase 4 | **loom CLI** | 合约协商 → 实现 → 验证循环 | 先自主后交互 | [phase-4-execution.md](phase-4-execution.md) |

**状态检测**:
- `spec.md` 不存在 → Phase 1
- `generator.md` 或 `evaluator.md` 不存在 → Phase 2
- `sprint-XX/feature-spec.md` 不存在 → Phase 3
- 以上都就绪 → Phase 4（调用 `loom run`）

## Phase 4 前置条件

调用 `loom run` 前，你必须已完成 Phase 1-3，确保以下文件存在：

```
.loom/<task>/
├── spec.md                    # Phase 1 产出（必需）
├── design-language.md         # Phase 2 产出（可选，存在时提升设计品质）
├── generator.md               # Phase 2 产出（必需）
├── evaluator.md               # Phase 2 产出（必需）
└── sprint-XX/
    └── feature-spec.md        # Phase 3 产出（至少一个 sprint）
```

## Git 要求

Loom 要求在 git 仓库中运行。Sprint 失败时 loom 会保留 Agent 的代码（`commit partial + tag`）而非销毁，因此直接在项目目录运行是安全的。运行前确保工作区干净（无未提交文件）。

```bash
loom run <task-name> --verbose
```

## CLI

```bash
loom run <task-name> [options]                    # 完整流水线（推荐）
loom negotiate <task-name> <sprint-id> [options]  # 单 Sprint 合约协商
loom execute <task-name> <sprint-id> [options]    # 单 Sprint 实现+验证
loom status <task-name>                           # 查看任务进度

# 选项
--project=<path>              # 指定项目根目录（默认: 当前工作目录）
--runtime=<name>              # 两个角色共用的运行时 (预设: claude, codex, gemini)
--generator-runtime=<name>    # 单独指定 Generator 运行时
--evaluator-runtime=<name>    # 单独指定 Evaluator 运行时
--verbose, -v                 # 详细日志

# 环境变量（优先级高于 CLI 参数）
LOOM_RUNTIME=claude                            # 预设名 (claude, codex, gemini)
```

运行时检测优先级: `LOOM_RUNTIME` / `--runtime` > 自动检测 PATH（claude → codex → gemini）

## Loom 产出的目录结构

```
.loom/<task>/
├── spec.md                        # 你创建 (Phase 1)
├── design-language.md             # 你创建 (Phase 2) — 可选，存在时注入所有 prompt
├── generator.md                   # 你创建 (Phase 2)
├── evaluator.md                   # 你创建 (Phase 2)
├── project-plan.md                # 你创建 (Phase 3) — Sprint 总体规划
├── state.json                     # loom 管理：任务状态机
├── context.md                     # loom 管理：跨 Sprint 知识传递（失败约束 + 执行记录）
├── sprint-XX/
│   ├── feature-spec.md            # 你创建 (Phase 3)
│   ├── contract.md                # loom 生成：协商通过的合约
│   ├── contract-negotiation.md    # loom 生成：协商历史（每轮增量追加）
│   └── eval-report.md             # loom 生成：最终评估报告
├── final-report.md                # loom 生成：最终汇总
├── loom-result.json              # loom 生成：机器可读结果
└── runs/                          # loom 生成：运行时产物
    ├── loom.log                  # 编排事件日志
    ├── generator.log              # Generator Agent 实时流式输出
    ├── evaluator.log              # Evaluator Agent 实时流式输出
    └── sprint-XX/
        ├── contract-draft.md      # 协商中的最新提案（通过后删除）
        └── eval-report-attempt-N.md  # 每次尝试的评估归档
```
