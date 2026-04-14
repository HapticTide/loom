/**
 * types.ts — Loom 共享类型定义
 *
 * 所有模块共用的接口、类型别名和运行时常量。
 */

// --- 角色文件（~/.loom/projects/<project-name>/<task>/ 任务目录）---

/** Generator 和 Evaluator 的角色指令文件内容 */
export interface RoleFiles {
  /** generator.md 内容 — Generator Agent 的系统指令 */
  generator: string;
  /** evaluator.md 内容 — Evaluator Agent 的系统指令 */
  evaluator: string;
}

// --- 运行时常量（可通过环境变量覆盖）---

/** 安全解析正整数环境变量，无效值回退到默认值 */
function envInt(key: string, fallback: number): number {
  const val = Number(process.env[key]);
  return Number.isFinite(val) && val > 0 ? Math.floor(val) : fallback;
}

/** 单次 loom run 最多执行的 Sprint 数量 */
export const MAX_SPRINTS = envInt("LOOM_MAX_SPRINTS", 20);
/** 单个 Sprint 实现+验证的最大重试次数 */
export const MAX_RETRIES = envInt("LOOM_MAX_RETRIES", 3);
/** 合约协商的最大轮次 */
export const MAX_NEGOTIATION_ROUNDS = envInt("LOOM_MAX_NEGOTIATION_ROUNDS", 5);

// --- Loom 配置（已解析，运行时使用）---

export interface LoomConfig {
  projectName: string;   // 项目名称 (e.g. "my-project")
  taskName: string;      // 任务名称 (e.g. "add-auth")
  taskDir: string;       // ~/.loom/projects/<name>/<task>/ 绝对路径
  projectRoot: string;   // Agent 的工作目录（项目根目录或 --project 指定的路径）
  runsDir: string;       // ~/.loom/projects/<name>/<task>/runs/ 运行时产物目录
  spec: string;          // spec.md 内容
  roleFiles: RoleFiles;  // generator.md + evaluator.md 内容
  designLanguage: string; // design-language.md 内容（空字符串 = 未配置）
  verbose: boolean;
}

// --- Sprint 结果 ---

/** 合约协商产出 */
export interface NegotiationResult {
  approved: boolean;
  rounds: number;
  /** 超过最大轮次后强制通过 */
  forcedApproval: boolean;
}

/** 单个 Sprint 的执行结果 */
export interface SprintResult {
  sprintId: string;
  success: boolean;
  /** 实际尝试次数（1 = 一次通过） */
  attempts: number;
  durationMs: number;
}

// --- Loom 结果 ---

/** 整个 loom run 的最终结果 */
export interface LoomResult {
  success: boolean;
  sprints: SprintResult[];
  totalDurationMs: number;
  taskDir: string;
}
