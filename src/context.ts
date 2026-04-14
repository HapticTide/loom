/**
 * context.md — 跨 Sprint 知识传递
 *
 * 单一文件记录环境约束、sprint 执行记录和失败约束。
 * 注入所有 agent prompt（Generator、Evaluator、协商）。
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface FailureRecord {
  attempt: number;
  failedItems: string[];
}

const CONTEXT_FILE = "context.md";
/** context.md 最大字节数 — 超出后截断旧内容，保留最新部分 */
const MAX_CONTEXT_BYTES = 64 * 1024;

/** 加载 context.md（如果存在） */
export function loadContext(taskDir: string): string {
  const contextPath = path.join(taskDir, CONTEXT_FILE);
  if (fs.existsSync(contextPath)) {
    return fs.readFileSync(contextPath, "utf-8");
  }
  return "";
}

/** Sprint 完成后追加上下文（sprint 摘要 + 失败约束 + 交付物） */
export function appendSprintContext(
  taskDir: string,
  sprintId: string,
  success: boolean,
  attempts: number,
  failureHistory: FailureRecord[],
): void {
  const contextPath = path.join(taskDir, CONTEXT_FILE);

  // 确保文件存在
  if (!fs.existsSync(contextPath)) {
    fs.writeFileSync(contextPath, "# Loom Execution Context\n");
  }

  const lines: string[] = [];

  // 成功时记录交付物 — 后续 Sprint 据此知道前序 Sprint 创建了什么
  if (success) {
    const deliverables = extractDeliverables(taskDir, sprintId);
    if (deliverables) {
      lines.push(`\n## Deliverables from ${sprintId}`);
      lines.push(deliverables);
    }
  }

  // 追加失败约束（即使 sprint 最终成功，失败约束也有跨 sprint 价值）
  const allConstraints = failureHistory.flatMap((h) => h.failedItems);
  if (allConstraints.length > 0) {
    lines.push(`\n## Constraints from ${sprintId}`);
    const unique = [...new Set(allConstraints)];
    for (const c of unique) {
      lines.push(`- ${c}`);
    }
  }

  // 追加 sprint 完成记录
  const status = success ? `✅ passed (attempt ${attempts})` : `❌ failed (${attempts} attempts)`;
  lines.push(`\n## Sprint Record`);
  lines.push(`- ${sprintId}: ${status}`);

  if (lines.length > 0) {
    fs.appendFileSync(contextPath, lines.join("\n") + "\n");
  }

  // 超出上限时截断旧内容，保留后半部分
  truncateIfNeeded(contextPath);
}

/** 从 contract.md 提取 Deliverables 和 API Endpoint Summary */
function extractDeliverables(taskDir: string, sprintId: string): string {
  const contractPath = path.join(taskDir, sprintId, "contract.md");
  if (!fs.existsSync(contractPath)) return "";

  const contract = fs.readFileSync(contractPath, "utf-8");
  const sections: string[] = [];

  // 提取 Deliverables 表（通常是 | # | File | Action | 格式）
  const delMatch = contract.match(/## Deliverables\s*\n([\s\S]*?)(?=\n## |\n---|\n$)/i);
  if (delMatch) sections.push(delMatch[1].trim());

  // 提取 API Endpoint Summary 表（如果存在）
  const apiMatch = contract.match(/## API Endpoint Summary\s*\n([\s\S]*?)(?=\n## |\n---|\n$)/i);
  if (apiMatch) sections.push(apiMatch[1].trim());

  return sections.join("\n\n");
}

/** 文件超出 MAX_CONTEXT_BYTES 时截断旧内容，在 ## 边界处切割 */
function truncateIfNeeded(filePath: string): void {
  const stat = fs.statSync(filePath);
  if (stat.size <= MAX_CONTEXT_BYTES) return;

  const content = fs.readFileSync(filePath, "utf-8");
  // 保留后 3/4 的内容，在最近的 ## 标题边界处切割
  const keepFrom = Math.floor(content.length / 4);
  const sectionStart = content.indexOf("\n## ", keepFrom);
  if (sectionStart === -1) return; // 找不到合适的切割点

  const trimmed = "# Loom Execution Context\n\n_（旧内容已截断）_\n" + content.slice(sectionStart);
  fs.writeFileSync(filePath, trimmed);
}
