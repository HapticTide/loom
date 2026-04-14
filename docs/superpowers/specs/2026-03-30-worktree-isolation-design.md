# Worktree Isolation: Agent 执行环境隔离

## Problem

Loom 的 Agent（Generator / Evaluator）直接在用户的 `projectRoot`（主 working tree）中运行。这产生三个架构级缺陷：

### 1. 数据安全风险

Sprint 失败时的回滚逻辑 (`sprint-executor.ts:180`)：

```typescript
git(projectRoot, ["reset", "--hard", `${tagPrefix}/start`]);
```

这会**不可逆地摧毁** projectRoot 中所有未提交的用户工作（暂存区 + 工作区）。当前的 `hasUncommittedChanges()` 检查仅输出警告，不阻止执行。

### 2. 工作流互斥

Loom 运行期间，用户不能在同一 working tree 上工作：
- Agent 修改文件 → IDE file watcher 频繁刷新
- `git add -A` 捕获用户进行中的改动
- `git commit` 将 Loom 产物和用户未完成的工作混在一起

### 3. 并行执行不可能

同一项目的多个 task 需要各自独立的 working directory + index + HEAD。共享同一 working tree 时无法并行。

## Design Principles

### 从第一性原理

Loom 是一个**自主 multi-agent 系统**，它对工作目录执行**破坏性操作**（文件写入、删除、hard reset）。从系统隔离角度：

> 任何自主系统操作共享可变状态时，如果缺乏隔离机制，必然产生竞争和数据损坏。

Agent 的执行环境 **必须** 与人类开发者的工作目录正交。

### 选择 Git Worktree（而非 clone / copy）

| 方案 | 磁盘开销 | 共享 refs | 共享 objects | 设置成本 |
|------|---------|----------|-------------|---------|
| `git clone` | 完整 repo 副本 | ❌ 需 fetch | ❌ 独立存储 | 高（网络 + 磁盘） |
| `cp -r` | 完整目录副本 | ❌ 无 git | ❌ 独立存储 | 高（大 repo 慢） |
| **`git worktree`** | **仅 working tree** | **✅ 即时共享** | **✅ 共享** | **低（秒级）** |

Git worktree 是 git 原生功能（`git worktree add`），创建一个与主 repo 共享 `.git` objects、refs、config 的独立 working directory，拥有自己的：
- working tree（文件系统）
- index（暂存区）
- HEAD（当前 commit）

Loom 创建的 tag（`loom/<sprintId>/done`）对主 worktree 即时可见。

### 与 `~/.loom/` 集中式哲学的一致性

现有架构将所有 loom 数据集中在 `~/.loom/` 中，零项目目录污染。Worktree 也应遵循此原则：

```
~/.loom/
├── projects/       # 已有：任务数据
├── worktrees/      # 新增：Agent 执行用 worktree
│   └── <project-name>/
│       └── <task-name>/   # 一个 worktree = 一个 task 的执行环境
└── index.json
```

## Solution

### 架构决策：Skill 管理 Worktree，Loom 是纯执行引擎

核心洞察：Worktree 生命周期属于 **环境准备**，而非 **执行逻辑**。Loom 是纯执行引擎，不应耦合环境准备。

```
Skill (Coding Agent):
  ├─ Phase 1-3: 创建 spec、角色文件、sprint 计划
  ├─ git worktree add ~/.loom/worktrees/<project>/<task>/ -b loom/<task> HEAD
  ├─ loom run <task> --project=<worktree-path>
  ├─ 向用户汇报结果 + worktree 路径
  ├─ 用户审查 → Coding Agent 执行 merge
  └─ git worktree remove + git branch -d

Loom Engine:
  ├─ 接收 --project=<path>（可以是 worktree 或主 repo）
  ├─ 验证 isGitRepo() → 非 git 直接报错
  └─ Sprint 执行（negotiate → generate → evaluate）
```

**为什么不在 loom 引擎中管理 worktree**：
- **最简原则** — loom 是执行引擎，不应耦合环境准备逻辑
- **Merge 时机由人决定** — 自动 merge 跳过了审查环节
- **Coding Agent 天然有 git 能力** — 无需 loom 封装

### Loom 引擎变更

唯一的引擎侧变更：在 `runLoom()` 入口检查 `isGitRepo()`，非 git 项目直接报错（而非静默退化）。

```typescript
// git.ts — 仅新增 isGitRepo
export function isGitRepo(cwd: string): boolean {
  try {
    git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

// orchestrator.ts — 入口校验
if (!isGitRepo(config.projectRoot)) {
  throw new Error(
    `projectRoot 不是 git 仓库：${config.projectRoot}\n` +
    `Loom 需要 git 来管理 Sprint 状态。请在 git 仓库（或 worktree）中运行。`
  );
}
```

### Skill 侧 Worktree 管理

Worktree 操作由 Coding Agent 通过原生 git 命令执行，无需 loom 封装：

```bash
# 创建 worktree
git worktree add ~/.loom/worktrees/<project>/<task>/ -b loom/<task> HEAD

# 安装依赖（如需要）
cd ~/.loom/worktrees/<project>/<task>/
npm install  # 或项目使用的包管理器

# 调用 loom
loom run <task> --project=~/.loom/worktrees/<project>/<task>/

# 用户审查后合并
cd /path/to/main-repo
git merge loom/<task> --no-ff -m "loom: merge <task>"

# 清理
git worktree remove ~/.loom/worktrees/<project>/<task>/
git branch -d loom/<task>
```

## Edge Cases & Mitigations

### 1. 非 Git 项目

**应对**：`isGitRepo()` 返回 false 时直接报错。Loom 依赖 git（tag、commit、reset），不支持非 git 项目。

### 2. 同一分支不能在两个 worktree 签出

**应对**：Skill 使用 `loom/<task>` 前缀创建专属分支，不与用户当前分支同名。

### 3. 子模块

`git worktree add` 默认不初始化子模块。

**应对**：Skill 在创建 worktree 后检测 `.gitmodules`，按需执行 `git submodule update --init --recursive`。

### 4. 大型项目的 `node_modules` / 依赖

Worktree 不复制 `node_modules`、`target/`、`.venv` 等 build artifacts。

**应对**：Skill 在 worktree 创建后，根据项目类型安装依赖（如 `npm install`）。

### 5. Worktree 异常残留

**应对**：Skill 在创建前检查同名 worktree 是否存在，存在则先 `git worktree remove`。

### 6. 磁盘空间

Git worktree 共享 `.git` objects/packfiles，磁盘开销仅为一份源码文件副本。

### 7. Agent Harness 文件（CLAUDE.md / AGENTS.md）

Worktree 中会 checkout 所有 git tracked 文件，包括 CLAUDE.md / AGENTS.md。**零影响**。

### 8. Merge 冲突

用户在 loom 运行期间修改了相同文件，merge 时可能冲突。

**应对**：Coding Agent 在 merge 时处理冲突，或提请用户介入。分支 `loom/<task>` 保留至用户确认。

## Implementation Changes

### Loom 引擎变更（极简）

| File | Action | Scope |
|------|--------|-------|
| `src/git.ts` | 新增 | `isGitRepo()` 函数（5 行） |
| `src/orchestrator.ts` | 修改 | 入口增加 `isGitRepo()` 校验，非 git 报错 |
| `src/__tests__/unit/git.test.ts` | 新增 | `isGitRepo` 单元测试 |

### 删除的代码（简化）

| Item | Reason |
|------|--------|
| `createWorktree`、`removeWorktree` 等 worktree CRUD | Skill 直接用 git CLI |
| `getWorktreePath`、`getWorktreeBranch` | Skill 自行管理路径 |
| `LoomConfig.originalProjectRoot` | Loom 不需要知道原始 repo |
| `hasUncommittedChanges` 检查 | Worktree 始终是干净的 |
| `worktree-flow.test.ts`、`worktree.test.ts` | Loom 不管理 worktree |

### Skill 侧变更

| File | Action | Scope |
|------|--------|-------|
| `.claude/skills/loom/SKILL.md` | 更新 | 新增 "Worktree 隔离" 章节 |
| `.claude/skills/loom/phase-4-execution.md` | 更新 | Phase 4 前增加 worktree 创建步骤 |

### Files NOT Changed

| File | Reason |
|------|--------|
| `src/sprint-executor.ts` | 使用 `config.projectRoot`，worktree 路径透明传入 |
| `src/negotiator.ts` | 不涉及 projectRoot |
| `src/runtime.ts` | `workDir` 由调用方传入 |
| `src/reporter.ts` | 使用 `config`，透明 |
| `src/context.ts` | 只操作 `taskDir`（在 `~/.loom/` 中） |

## What Does NOT Change

- **`~/.loom/` 目录结构** — 任务数据、状态、索引完全不变
- **CLI 接口** — `loom run <task>` 参数不变（`--project=` 已存在）
- **Agent Prompt 格式** — 所有 prompt 构建函数不变
- **Sprint 执行语义** — negotiate → generate → evaluate 流程不变
- **Tag 约定** — `loom/<sprintId>/start`、`loom/<sprintId>/done` 不变

## Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| 依赖未安装导致 Agent 在 worktree 中失败 | Medium | Skill 负责依赖安装 |
| Merge 冲突 | Low | Coding Agent 处理或提请用户介入 |
| 老版本 git 不支持 worktree | Very Low | git 2.5 (2015) 起支持 |

## Migration

**已实现** (2026-03-30)。

最终方案比初始设计大幅简化：Worktree 生命周期从 loom 引擎移至 Skill 层。
Loom 引擎仅新增 `isGitRepo()` 校验（非 git 报错），其余不变。

### 测试覆盖

- **2 个 git 单元测试** (`git.test.ts`)：isGitRepo true/false
- **172 个测试全部通过**（含所有已有测试）
