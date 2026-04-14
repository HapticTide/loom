# Phase 2: 工作区生成

## 目标

基于 `spec.md` + 项目上下文，生成三个文件：

1. **`design-language.md`** — 设计审美校准，可选但强烈推荐（存在时直达所有 Agent prompt 顶部，最高杠杆）
2. **`generator.md`** — Generator 的编码策略（必需）
3. **`evaluator.md`** — Evaluator 的验证策略（必需）

## 协作模式

**自主** — 无需用户交互。分析项目后直接生成。

---

## 核心原则

**Evaluator 宁严勿松。** 过松 → 低质量代码通过。过严 → 重试增加但最终质量高。

> "Out of the box, Claude is a poor QA agent. I watched it identify issues, then talk itself into deciding they weren't a big deal and approve the work anyway." — Anthropic

**分析先于生成。** 角色文件必须从项目实际代码推导，不可套通用模板。

**策略定制，格式不管。** 报告格式（✅/❌ 标记、JSON verdict、APPROVED/REVISE）由引擎自动注入。角色文件只定义策略和态度。

---

## Step 1: 项目上下文分析

生成任何文件之前，**必须**先分析项目：

1. **技术栈**: 从 package.json / go.mod / pyproject.toml / Cargo.toml 识别语言、框架、依赖
2. **编码约定**: 读取 2-3 个典型源文件，提取命名风格、导入方式、模块化模式、错误处理、类型使用
3. **质量工具链**: 从 package.json scripts / Makefile 提取已有的 lint / typecheck / test 命令

---

## Step 2: 生成 `design-language.md`

> "The prompting associated with the criteria directly shaped the character of the output." — Anthropic
> "I calibrated the evaluator using few-shot examples with detailed score breakdowns." — Anthropic

这是**唯一的代码范例文件**。它同时服务 Generator（知道写什么样的代码）和 Evaluator（知道什么水平算通过）。引擎将其注入所有 prompt 顶部。

### 模板

```markdown
# Design Language

## 设计宣言
[从 spec.md 提取。1-3 句话，用隐喻定义代码审美目标]

## 代码审美范例

### 范例 1: [核心模式，如：错误处理]

❌ 不达标 — 能跑但设计品质不够:
```[language]
[代码]
```
问题: [具体——关注点混合、类型不安全、错误处理粗放等]

⚠️ 及格 — 可接受的最低标准:
```[language]
[同一功能的中等品质实现——能跑、结构基本合理，但有明确局限]
```
局限: [具体——比如编排逻辑留在胶水层、类型推导不够 DRY、缺少边界防御]

✅ 达标 — 本项目的标准:
```[language]
[同一功能的高品质实现]
```
优点: [具体——关注点分离、类型表达力、可组合等]

### 范例 2: [另一核心模式，如：模块边界]
...

## 反模式
- [具体反模式 + 为什么不可接受]
```

**编写规则**：
- 从项目实际技术栈选取 2-3 个核心模式
- 三个版本**功能等价**——都能跑，❌ 有结构性问题，⚠️ 基本合理但有明确短板，✅ 是本项目的标杆
- Generator 应模仿 ✅ 达标。Evaluator 将 ⚠️ 及格标记为 NOTE，❌ 不达标标记为 FAIL
- 范例必须来自项目的语言和框架，不用通用伪代码
- **⚠️ 与 ✅ 的差距必须具体**——不是模糊的「更好」，而是可操作的差异（如：「编排逻辑应封装到 service 函数」「共享类型应提取到 types 文件」）

---

## Step 3: 生成 `generator.md`

定义 Generator 的编码策略。**不要重复 design-language.md 的范例**。

### 必须包含

```markdown
# Generator 角色定义

[一句话：你是使用 X + Y + Z 的 [角色]。]

## 技术栈
[语言、框架、包管理器 — 从 Step 1 提取]

## 编码规范
[具体的命名、导入、模块化、错误处理约定 — 从 Step 1 提取]
❌ "使用一致的命名约定"
✅ "变量/函数 camelCase，类/接口 PascalCase，常量 UPPER_SNAKE_CASE"

## 边界安全
外部输入（HTTP body、CLI args、env vars）进入系统的边界处：
- 数值转换用防御模式，不依赖 falsy guard:
  ❌ `if (x) x = Number(x)` — "0" 是 falsy 会被跳过，Number("abc") 静默产生 NaN
  ✅ `const n = Number(x); if (isNaN(n)) return error(...)` 或用 parseInt + 范围检查
- 字符串分割后 trim: `.split(",").map(s => s.trim())`
- 测试必须覆盖：缺失参数、类型错误参数、空字符串、"0" 值

## 共享类型归属
被 3 个以上文件 import 的 interface/type 必须定义在独立的 types 文件中，
不能寄生在某个具体实现文件里。

## 架构规范
[分层策略、依赖方向、文件组织]

## 质量底线
[可执行的质量检查命令，如: npx tsc --noEmit && npm test]

## 协商职责
[合约协商阶段如何提出 AC 和验证命令]
- BEHAVIORAL [PREFLIGHT] AC：只用项目工具链命令（build/test/lint），expected 留空，靠 exit code 判定
- STRUCTURAL [PREFLIGHT] AC：只用单条 grep/find/wc 命令，禁止管道、重定向、命令替换
- DESIGN AC：指定审查文件和标准，由 Evaluator 读代码判断
- 禁止自制 grep 管道、awk、sed 验证脚本

## 实现职责
[实现阶段的行为规范：按合约实现、只创建 Deliverables 文件、运行质量检查、git commit]

## 禁止事项
- 不要 stub 功能（TODO、placeholder、硬编码返回值）
- [项目特定 anti-patterns]
```

---

## Step 4: 生成 `evaluator.md`

定义 Evaluator 的验证策略。**代码审美范例已在 design-language.md 中，不要重复——直接引用。**

### 必须包含

```markdown
# Evaluator 角色定义

[一句话：你是严格的 [角色] QA 工程师。你的职责是找出问题，不是证明代码可以工作。]

## 验证工具链
[从 Step 1 提取：测试、类型检查、lint、API 验证工具]

## 评判标准
[每个维度：具体标准 + 硬阈值，低于阈值即 FAIL]
- 功能完整性: 所有 AC 必须真正可用（不是 stub）
- 构建质量: typecheck / lint / test 全部通过
- 错误处理: 无未捕获异常导致崩溃
- 设计品质: 对照 design-language.md 的范例评判
  - 代码匹配 ✅ 达标品质 → PASS
  - 代码匹配 ⚠️ 及格品质 → NOTE（首次评估不 FAIL，但 retry 时如果仍停留在及格水平则 FAIL）
  - 代码匹配 ❌ 不达标品质 → FAIL

## 标准质量门

合约协商阶段，以下质量门必须转化为 AC 纳入合约。
QG-1/QG-2/QG-4 是行为约束，映射为 BEHAVIORAL [PREFLIGHT] 测试 AC。
QG-3 是结构约束，映射为 DESIGN AC（Evaluator 读代码判断）。

### QG-1: 边界值安全 → BEHAVIORAL [PREFLIGHT]
接受外部输入的函数，数值转换必须防御 NaN 和 falsy 陷阱。
协商时：为每个接受数值参数的端点/命令，增加一个 invalid input 测试 AC（用项目测试命令，exit code 判定）。

### QG-2: 测试覆盖质量 → BEHAVIORAL [PREFLIGHT]
测试不仅验证 happy path，还必须验证至少一个 error path。
协商时：确保测试 AC 要求 "test file exists AND passes"（exit code 0），同时至少有一个测试用例验证 invalid/missing input 的行为。

### QG-3: 共享类型归属 → DESIGN AC
被多个文件 import 的类型必须在独立 types 文件中定义。
协商时：增加 DESIGN AC，指定审查文件范围和共享类型归属标准，由 Evaluator 读代码判断。
禁止使用 grep 管道命令做共享类型验证。

### QG-4: 测试真实性 → BEHAVIORAL [PREFLIGHT]
测试必须真正执行被测代码路径，不能只验证 "功能关键词存在于测试文件中"。
协商时：行为 AC 验证测试通过（exit code 0），不用 grep 验证测试文件内容。

## 评估纪律

### 禁止自我说服
发现问题就报告。不要说服自己"不是大问题"。发现即报告，严重度判定后不降级。

### 禁止表面通过
应用"启动了" ≠ 功能正确。必须实际执行验证命令并检查输出。

### 禁止信任 Generator
Generator 声称"已实现"。独立验证每个功能。

### Stub 检测
[列出项目技术栈特定的 stub 模式]
发现 stub → 该 AC 立即 FAIL

### Anti-gaming
AC 验证的是实现意图，不仅是字面输出。检查：
- 测试存在但未执行被测逻辑
- 输出匹配但原因是硬编码而非正确实现
发现博弈 → 该 AC 立即 FAIL

## 严格程度
| 硬性 → FAIL | stub、功能不工作、测试/构建失败、安全漏洞、博弈实现 |
| 硬性 → FAIL | 标准质量门（QG-1 到 QG-4）不满足 |
| CRITICAL → FAIL | 超出 AC 但发现静默正确性问题 |
| 软性 → 📝 NOTE | 命名偏好、非关键注释、⚠️ 及格水平代码（首次评估） |
| 不验证 | 性能（除非 spec 要求）、代码风格偏好 |

## 协商职责
[审查合约提案时的标准：命令可执行、spec 覆盖完整]
协商时额外检查：
- 标准质量门是否已转化为具体 AC（QG-1/2/4 → BEHAVIORAL 测试 AC，QG-3 → DESIGN AC）
- [PREFLIGHT] AC 是否只用项目工具链命令（build/test/lint）或单条 grep/find 命令
- [PREFLIGHT] AC 的 expected output 是否为空（必须靠 exit code 判定）
- 是否存在 grep 管道、awk、sed、命令替换等自制验证脚本 → 要求改为 DESIGN AC 或简化为单条命令
```

---

## 新项目（从零开始）

无现有源码时：从 spec.md 技术约束推导技术栈，使用社区最佳实践。generator.md 指示第一个 Sprint 建立工具链。

---

## 退出条件

- [ ] `design-language.md` 包含设计宣言 + 至少 2 个代码审美范例（来自项目实际技术栈）
- [ ] `design-language.md` 每个范例包含 3 级（❌ 不达标 / ⚠️ 及格 / ✅ 达标），⚠️ 与 ✅ 的差距有具体可操作的描述
- [ ] `generator.md` 包含项目特定编码规范（非通用模板）+ 边界安全 + 共享类型归属 + anti-stub + 协商/实现双重职责
- [ ] `evaluator.md` 包含评判维度 + 硬阈值 + 标准质量门（QG-1~QG-4，QG-1/2/4 映射为 BEHAVIORAL 测试 AC，QG-3 映射为 DESIGN AC）+ anti-leniency 纪律（至少 4 条）+ 协商职责（含 [PREFLIGHT] AC 安全规则）
- [ ] `evaluator.md` 引用 design-language.md 的 3 级体系进行设计品质评判（不重复范例）
- [ ] 角色文件不包含报告格式指令（引擎已处理）

完成后 → **Phase 3: Sprint 规划**
