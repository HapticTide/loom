# Loom

自主多 Agent 实现引擎 — 从结构化需求到高质量交付的全自动构建系统。

Loom 接管实现阶段：合约协商 → 编码 → 机械验证 → 代码审查 → 迭代修复 → 交付报告。宿主 Agent（Claude Code 等）负责规划，Loom 负责执行。

## 工作原理

```
宿主 Agent（Claude Code 等）
  │
  ├── Phase 1: 与用户协商需求 → spec.md
  ├── Phase 2: 分析项目生成角色文件 → generator.md / evaluator.md / design-language.md
  ├── Phase 3: 分解 Sprint → sprint-XX/feature-spec.md
  │
  └── Phase 4: loom run <task>
           │
    ┌──────▼──────┐
    │  Sprint 循环  │
    │              │
    │  合约协商     │  Generator 提出合约 ↔ Evaluator 审查
    │  ↓ APPROVED  │  → contract.md
    │              │
    │  实现         │  Generator 按合约编码（无头 Agent）
    │  ↓           │
    │  机械验证     │  Preflight: build / test / lint（exit code）
    │  ↓           │
    │  代码审查     │  Evaluator 全量验证（无头 Agent，独立实例）
    │  ↓           │
    │  通过? ──→ 下一个 Sprint
    │  失败? ──→ 注入失败历史，Generator 修复（最多 3 轮）
    └─────────────┘
           │
           ▼
    final-report.md + 代码变更
```

**核心设计**：

- **零 SDK 依赖** — 通过子进程调用无头 Coding Agent CLI（Claude Code / Codex / Gemini），Agent 自动继承项目 harness
- **文件系统即协议** — Agent 间不直接通信，Orchestrator 读文件 → 构建 prompt → 调用 Agent → 写结果
- **失败记忆** — 每轮失败的验收条目注入下一轮 prompt，防止 Generator 重复犯错
- **知识传递** — 跨 Sprint（context.md）和跨任务（lessons.md）的经验积累

## 安装

```bash
git clone <repo-url> && cd loom
bun install
bun run build    # 产出 dist/index.js
```

需要安装至少一个 Coding Agent CLI：

```bash
npm install -g @anthropic-ai/claude-code    # Claude Code
npm install -g @openai/codex                # Codex CLI
npm install -g @anthropic-ai/gemini-cli     # Gemini CLI
```

## 使用方式

### 作为 Claude Code Skill（推荐）

安装后 Loom 注册为 Claude Code skill。在对话中描述需求即可触发四阶段工作流：

```
> /loom 给项目添加用户认证系统
```

宿主 Agent 自动完成 Phase 1-3（需求协商、角色生成、Sprint 规划），然后调用 `loom run` 执行。

### 直接 CLI

```bash
# 完整流水线（前提：Phase 1-3 已完成）
loom run <task-name> [options]

# 单 Sprint 操作
loom negotiate <task-name> <sprint-id> [options]    # 合约协商
loom execute <task-name> <sprint-id> [options]      # 实现 + 验证

# 查看进度
loom status <task-name>
```

**选项**：

| 选项 | 说明 |
|------|------|
| `--project=<path>` | 项目根目录（默认：当前目录） |
| `--runtime=<name>` | Agent 运行时预设（claude / codex / gemini） |
| `--generator-runtime=<name>` | Generator 单独指定运行时 |
| `--evaluator-runtime=<name>` | Evaluator 单独指定运行时 |
| `--verbose`, `-v` | 详细日志 |

运行时检测优先级：环境变量 > CLI 参数 > 自动检测 PATH（claude → codex → gemini）。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LOOM_RUNTIME` | 运行时预设 | 自动检测 |
| `LOOM_GENERATOR_RUNTIME` | Generator 运行时 | 同 `LOOM_RUNTIME` |
| `LOOM_EVALUATOR_RUNTIME` | Evaluator 运行时 | 同 `LOOM_RUNTIME` |
| `LOOM_MAX_SPRINTS` | 最大 Sprint 数 | 20 |
| `LOOM_MAX_RETRIES` | 每个 Sprint 最大重试次数 | 3 |
| `LOOM_MAX_NEGOTIATION_ROUNDS` | 合约协商最大轮数 | 5 |
| `LOOM_AGENT_TIMEOUT_MS` | Agent 子进程超时 | 1800000 (30 min) |

## 四阶段工作流

### Phase 1: 需求协商

宿主 Agent 与用户多轮对话，将模糊意图扩展为结构化 `spec.md`。重点：扩展用户意图而非形式化、约束交付物而非路径、定义边界（"不做什么"比"做什么"更重要）。

### Phase 2: 工作区生成

宿主 Agent 分析项目代码后生成三个文件：

- **`design-language.md`**（可选）— 代码审美校准，含 ❌/⚠️/✅ 三级范例，注入所有 prompt 顶部
- **`generator.md`** — Generator 编码策略：技术栈、编码规范、边界安全、协商/实现职责
- **`evaluator.md`** — Evaluator 验证策略：评判标准、质量门（QG-1~QG-4）、反作弊纪律

### Phase 3: Sprint 规划

将 spec 分解为可独立验证的 Sprint。按功能模块拆分（非技术层），第一个 Sprint 是基础设施。每个 Sprint 产出 `feature-spec.md`，只描述 What，不描述 How to Verify。

### Phase 4: 执行交付

Loom CLI 接管，自主执行 Sprint 循环。每个 Sprint 经历：

1. **合约协商** — Generator 提出验收条目，Evaluator 审查（最多 5 轮，未通过则强制批准）
2. **实现** — Generator 按合约编码并 commit
3. **Preflight** — 机械验证（build/test/lint），exit code 判定，失败直接跳过 Evaluator
4. **Evaluator 审查** — 独立实例全量验证，输出 eval-report.md
5. **迭代** — 失败时注入历史，Generator 修复（最多 3 轮）

## 目录结构

```
~/.loom/                              # 集中式存储
├── index.json                        # 全局项目索引
└── projects/
    └── <project-name>/
        ├── lessons.md                # 跨任务知识（自然衰减，4KB 上限）
        └── <task>/
            ├── spec.md               # Phase 1: 需求文档
            ├── design-language.md    # Phase 2: 设计审美校准（可选）
            ├── generator.md          # Phase 2: Generator 角色
            ├── evaluator.md          # Phase 2: Evaluator 角色
            ├── project-plan.md       # Phase 3: Sprint 规划
            ├── state.json            # 任务状态机
            ├── context.md            # 跨 Sprint 知识传递
            ├── sprint-XX/
            │   ├── feature-spec.md   # Phase 3: Sprint 需求
            │   ├── contract.md       # 协商通过的合约
            │   └── eval-report.md    # 最终评估报告
            ├── final-report.md       # 交付报告
            ├── loom-result.json      # 机器可读结果
            └── runs/                 # 运行时日志
                ├── loom.log
                ├── generator.log
                └── evaluator.log

<project>/
└── .loom → ~/.loom/projects/<project-name>/   # 软链接（自动 gitignore）
```

## 监控执行

```bash
# 后台运行 + 实时监控
loom run <task-name> --verbose &
tail -f .loom/<task>/runs/generator.log    # Generator 输出
tail -f .loom/<task>/runs/evaluator.log    # Evaluator 输出
tail -f .loom/<task>/runs/loom.log         # 编排事件
```

## 质量保障机制

**合约中的标准质量门**：

| 质量门 | 类型 | 验证方式 |
|--------|------|----------|
| QG-1: 边界值安全 | BEHAVIORAL [PREFLIGHT] | 数值转换防御 NaN/falsy，测试 exit code |
| QG-2: 测试覆盖 | BEHAVIORAL [PREFLIGHT] | happy path + error path，测试 exit code |
| QG-3: 共享类型归属 | DESIGN | Evaluator 读代码判断 |
| QG-4: 测试真实性 | BEHAVIORAL [PREFLIGHT] | 测试真正执行被测路径，非 grep 验证 |

**Evaluator 纪律**：禁止自我说服、禁止表面通过、禁止信任 Generator、Stub 检测、Anti-gaming。

## Git 集成

Loom 要求在 git 仓库中运行，执行前确保工作区干净。

- Sprint 开始：`git tag loom/<task>/<sprint>/start`
- Sprint 成功：`git commit` + `git tag loom/<task>/<sprint>/done`
- Sprint 失败：`git commit` 保留代码 + `git tag loom/<task>/<sprint>/partial`

回滚到 Sprint 起点：`git reset --hard loom/<task>/<sprint>/start`

## 技术栈

- **Runtime**: Bun + TypeScript
- **依赖**: picocolors（终端着色，唯一运行时依赖）
- **Agent 运行时**: 无头 Coding Agent CLI 子进程
- **通信协议**: 文件系统 (Markdown) + stdout 流式解析

## Roadmap

### Prompt 缓存优化

当前每次 Agent 调用都是新子进程，同一个 Sprint 内 Generator 最多被调用 3 次，每次都重新发送完整的 design-language + 角色文件 + context + contract。这些内容在 Sprint 内完全不变，但因为是独立进程，无法利用 Anthropic 的 prompt cache（5 分钟 TTL）。

计划：
- [ ] **会话复用** — 同一 Sprint 内的 Generator 重试复用同一个 Agent 进程（通过 Claude Code 的对话继续模式），避免重复发送不变的 prompt 前缀
- [ ] **Prompt 前缀分层** — 重构 prompt 拼接顺序，将稳定内容（design-language → 角色文件 → context → lessons）置于前部，易变内容（失败历史、合约）置于后部，最大化跨调用的前缀命中
- [ ] **API 直连模式** — 可选绕过 CLI，直接调用 Anthropic API 并显式设置 `cache_control` 断点，精确控制缓存边界

### 实时监控 UI

当前只能通过 `tail -f` 跟踪日志。对于多 Sprint 长时间运行，缺乏全局视图。

计划：
- [ ] **TUI 仪表盘** — 终端内实时展示：Sprint 进度条、当前阶段（协商/实现/验证）、Agent 工具调用流、耗时统计
- [ ] **Web Dashboard** — 本地 Web 服务，展示任务全景：Sprint 时间线、合约/评估报告在线浏览、token 用量图表、多任务并行监控

### 成本控制

- [ ] **Token 用量追踪** — 解析 Agent stdout 中的 usage 字段，按 Sprint / 角色 / attempt 维度统计 input/output/cache token
- [ ] **预算上限** — 设置任务级 token 预算，超出时暂停并询问用户
- [ ] **模型分级** — 协商阶段用轻量模型（Sonnet/Haiku），实现和验证阶段用重量模型（Opus），降低总成本

### 并行化

- [ ] **独立 Sprint 并行** — DAG 分析 Sprint 依赖关系，无依赖的 Sprint 并行执行（当前严格串行）
- [ ] **Evaluator 提前启动** — Generator commit 后立即启动 Evaluator，Preflight 与 Evaluator 部分重叠执行

### 工程化

- [ ] **npm 发布** — `npm install -g loom-engine`，全局安装即用
- [ ] **断点恢复** — 进程意外中断后从最后完成的 Sprint 继续，而非从头开始（当前通过 state.json + git tag 部分支持，需完善）
- [ ] **自定义质量门插件** — 允许项目定义额外的 QG 规则（如覆盖率阈值、bundle size 限制），合约协商时自动纳入

## License

MIT
