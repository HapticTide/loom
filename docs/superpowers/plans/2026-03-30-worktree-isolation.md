# Worktree Isolation Implementation Plan

> **Status: ✅ 已完成** (2026-03-30)

**Goal:** 让 Loom 的 Agent 执行环境运行在隔离的 git worktree 中，消除对用户主 working tree 的破坏性操作风险。

**最终架构:** Worktree 生命周期由 **Skill**（Coding Agent）管理，而非 loom 引擎。Loom 是纯执行引擎，仅接收 `--project=<path>` 参数。非 git 项目直接报错。

**Spec:** `docs/superpowers/specs/2026-03-30-worktree-isolation-design.md`

---

## 实施回顾

### 初始方案（已废弃）

初始方案在 loom 引擎中管理 worktree 全生命周期（创建、merge、清理），涉及 8 个文件改动、13 个新函数。经过架构审查后发现：

- loom 是执行引擎，不应耦合环境准备逻辑
- 自动 merge 跳过了人类审查环节
- Coding Agent 天然有 git 能力，无需 loom 封装

### 最终方案（已实施）

将 worktree 管理移至 Skill 层，loom 引擎变更极简：

- [x] `src/git.ts`: 新增 `isGitRepo()` 函数（5 行）
- [x] `src/orchestrator.ts`: 入口增加 `isGitRepo()` 校验
- [x] `src/__tests__/unit/git.test.ts`: isGitRepo 单元测试
- [x] `.claude/skills/loom/SKILL.md`: 新增 "Worktree 隔离" 章节
- [x] `.claude/skills/loom/phase-4-execution.md`: Phase 4 前增加 worktree 步骤
- [x] `docs/architecture.md`: §2.1.3 更新为 Skill 管理工作流

### 删除的代码

- [x] 移除 `createWorktree`、`removeWorktree`、`worktreeExists`、`pruneWorktrees` 等 worktree CRUD
- [x] 移除 `getWorktreePath`、`getWorktreeBranch` 路径函数
- [x] 移除 `LoomConfig.originalProjectRoot` 字段
- [x] 移除 `hasUncommittedChanges` 警告
- [x] 删除 `worktree-flow.test.ts`、`worktree.test.ts`

### 测试验证

```bash
bun test src/__tests__/
# 172 pass, 0 fail, 352 assertions, 14 files
```

## 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Worktree 创建者 | Skill（Coding Agent） | 最简原则，loom 不耦合环境准备 |
| 非 git 项目 | 直接报错 | loom 依赖 git，不支持降级 |
| Merge 时机 | 人类审查后 | 自动 merge 跳过审查 |
| Worktree 清理 | Skill 负责 | 与创建者一致 |
