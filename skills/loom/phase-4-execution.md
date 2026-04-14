# Phase 4: 执行交付

## 目标

运行 Loom 执行引擎，解析结果，向用户汇报并引导后续操作。

## 输入 / 输出

- **输入**: 完整的 `.loom/<task>/` 工作区（spec、design-language、角色文件、Sprint 目录）
- **输出**: 项目中的代码变更、`final-report.md`、用户汇报

## 协作模式

**先自主（运行 Loom），后交互（汇报结果）。**

---

## 核心原则

**多轮 QA 是预期行为。** Anthropic 的 DAW 实验中 Generator 经历 3 轮 QA 才通过。不要因为第一轮失败就认为系统出了问题。

**Stub 是最常见的失败模式。** Evaluator 最常捕获：按钮存在但点击无反应、API 端点返回 mock 数据、功能"看起来"可用但缺少关键交互。

---

## 步骤

### 1. 执行前检查

确认工作区完整：`spec.md`、`generator.md`、`evaluator.md`、至少一个 `sprint-XX/feature-spec.md`。缺失 → 回退到对应阶段。`design-language.md` 可选（存在时自动注入所有 prompt 提升设计品质）。

### 1.5 确认工作区干净

Loom 执行时会使用 `git add -A` 和 `git commit`。确保项目无未提交文件：

```bash
git status --porcelain  # 应为空
```

如有未提交文件，先 commit 或 stash。

### 2. 运行 Loom

```bash
loom run <task-name> --verbose
```

**对用户说**: "正在自主实现中，多个 Agent 协作进行编码和验证..."
**不要说**: "正在运行 Loom"、"Sprint 1 开始"、"合约协商中"

### 3. 结果解析

```bash
cat .loom/<task>/final-report.md          # 最终报告
cat .loom/<task>/sprint-*/eval-report.md  # 失败详情
```

关注：哪些 Sprint 通过/失败、失败的 AC（特别是 stub 相关）、迭代轮数。

### 4. 向用户汇报

**成功**: 列出创建的文件和功能，询问用户是否审查代码。

**部分失败**: 列出已完成和未完成的模块，引用 Evaluator 报告中的具体发现。失败的 Sprint 代码已保留（`partial` tag），可在此基础上手动修复。

**完全失败**: 简洁描述错误，建议调整方案。

### 5. 后续操作

| 操作 | 说明 |
|------|------|
| 代码审查 | Review loom 生成的 commit |
| 手动修复 | 对失败部分直接修改（代码已保留） |
| 回滚 | `git reset --hard loom/<task>/<sprint>/start` 回到 sprint 起点 |
| 重新运行 | 调整 spec/角色文件后重新执行 |

---

## 错误处理

| 场景 | 处理 |
|------|------|
| loom 命令未找到 | 尝试 `npx loom`，失败则提示安装 |
| API 限流/网络错误 | 告知用户，建议稍后重试 |
| 全部 Sprint 失败 | 分析 eval-report，向用户解释原因 |

---

## 退出条件

- [ ] Loom 执行完成
- [ ] 结果已用自然语言汇报（不暴露内部术语）
- [ ] 用户已选择后续操作
