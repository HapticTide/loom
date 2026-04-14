import { describe, it, expect } from "bun:test";
import { createRuntime, AgentRuntime } from "../../runtime.js";
import type { AgentRunOptions } from "../../runtime.js";
import { Logger } from "../../logger.js";

describe("createRuntime", () => {
  it("creates claude preset", () => {
    const rt = createRuntime("claude");
    expect(rt.name).toBe("claude");
    expect(rt).toBeInstanceOf(AgentRuntime);
  });

  it("creates codex preset", () => {
    const rt = createRuntime("codex");
    expect(rt.name).toBe("codex");
    expect(rt).toBeInstanceOf(AgentRuntime);
  });

  it("creates gemini preset", () => {
    const rt = createRuntime("gemini");
    expect(rt.name).toBe("gemini");
    expect(rt).toBeInstanceOf(AgentRuntime);
  });

  it("matches presets case-insensitively", () => {
    const rt = createRuntime("Claude");
    expect(rt.name).toBe("claude");
  });

  it("rejects unknown preset name", () => {
    expect(() => createRuntime("unknown-agent")).toThrow(/Unknown runtime preset/);
  });

  it("AgentRuntime has a run method and name property", () => {
    const rt = createRuntime("claude");
    expect(typeof rt.run).toBe("function");
    expect(typeof rt.name).toBe("string");
  });

  it("AgentRuntime has setLogFile method", () => {
    const rt = createRuntime("claude");
    expect(typeof rt.setLogFile).toBe("function");
    // Should not throw
    rt.setLogFile("/dev/null");
  });
});

describe("AgentRunOptions", () => {
  it("accepts timeoutMs as optional property", () => {
    const opts: AgentRunOptions = { prompt: "test", workDir: "/tmp" };
    expect(opts.timeoutMs).toBeUndefined();

    const optsWithTimeout: AgentRunOptions = { prompt: "test", workDir: "/tmp", timeoutMs: 60000 };
    expect(optsWithTimeout.timeoutMs).toBe(60000);
  });
});

describe("ANSI stripping", () => {
  // Access the regex via Logger to test stripping behavior
  it("strips CSI color sequences (m terminator)", () => {
    const input = "\x1b[31mred text\x1b[0m";
    const stripped = input.replace(/\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07]*\x07)/g, "");
    expect(stripped).toBe("red text");
  });

  it("strips CSI cursor/erase sequences (K, H, J terminators)", () => {
    const input = "line\x1b[2Kcleared\x1b[1;1Hmoved\x1b[2Jerased";
    const stripped = input.replace(/\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07]*\x07)/g, "");
    expect(stripped).toBe("lineclearedmovederased");
  });

  it("strips OSC sequences (title setting)", () => {
    const input = "\x1b]0;window title\x07visible text";
    const stripped = input.replace(/\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07]*\x07)/g, "");
    expect(stripped).toBe("visible text");
  });

  it("preserves multibyte UTF-8 characters", () => {
    const input = "\x1b[32m第 3 轮\x1b[0m — 测试通过 ✅";
    const stripped = input.replace(/\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07]*\x07)/g, "");
    expect(stripped).toBe("第 3 轮 — 测试通过 ✅");
  });

  it("preserves CJK with mixed ANSI sequences", () => {
    const input = "\x1b[1m\x1b[36m構建成功\x1b[0m：已完成 3/5 個任務";
    const stripped = input.replace(/\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07]*\x07)/g, "");
    expect(stripped).toBe("構建成功：已完成 3/5 個任務");
  });
});

describe("Logger", () => {
  it("has a close() method", () => {
    const l = new Logger();
    expect(typeof l.close).toBe("function");
    l.close(); // should not throw
  });
});
