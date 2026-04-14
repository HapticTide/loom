import * as fs from "node:fs";
import type { AgentRunResult } from "../../runtime.js";

/** Mock that returns predefined responses in sequence */
export function createMockRuntime(responses: AgentRunResult[]) {
  let callIndex = 0;
  return {
    name: "mock",
    setLogFile(filePath: string): void {
      // 创建空日志文件，与真实 runtime 行为一致
      fs.writeFileSync(filePath, "");
    },
    run: async (): Promise<AgentRunResult> => {
      if (callIndex >= responses.length) {
        return { response: "", exitCode: 1 };
      }
      return responses[callIndex++];
    },
  };
}
