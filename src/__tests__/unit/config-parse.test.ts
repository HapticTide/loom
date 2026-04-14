import { describe, it, expect } from "bun:test";
import { parseCliArgs } from "../../config.js";
import { MAX_SPRINTS, MAX_RETRIES, MAX_NEGOTIATION_ROUNDS } from "../../types.js";

describe("parseCliArgs", () => {
  it("parses 'run <taskName>' with defaults", () => {
    const result = parseCliArgs(["run", "auth"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.taskName).toBe("auth");
      expect(result.verbose).toBe(false);
      expect(result.runtime).toBeUndefined();
      expect(result.generatorRuntime).toBeUndefined();
      expect(result.evaluatorRuntime).toBeUndefined();
    }
  });

  it("parses --verbose flag", () => {
    const result = parseCliArgs(["run", "auth", "--verbose"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.verbose).toBe(true);
    }
  });

  it("parses -v shorthand", () => {
    const result = parseCliArgs(["run", "auth", "-v"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.verbose).toBe(true);
    }
  });

  it("parses --runtime=claude", () => {
    const result = parseCliArgs(["run", "auth", "--runtime=claude"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.runtime).toBe("claude");
    }
  });

  it("parses separate generator and evaluator runtimes", () => {
    const result = parseCliArgs([
      "run",
      "auth",
      "--generator-runtime=claude",
      "--evaluator-runtime=codex",
    ]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.generatorRuntime).toBe("claude");
      expect(result.evaluatorRuntime).toBe("codex");
    }
  });

  it("parses --project=<path>", () => {
    const result = parseCliArgs(["run", "auth", "--project=/tmp/myproject"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.projectRoot).toBe("/tmp/myproject");
    }
  });

  it("parses 'negotiate <task> <sprint>'", () => {
    const result = parseCliArgs(["negotiate", "auth", "sprint-01"]);
    expect(result.type).toBe("negotiate");
    if (result.type === "negotiate") {
      expect(result.taskName).toBe("auth");
      expect(result.sprintId).toBe("sprint-01");
      expect(result.verbose).toBe(false);
    }
  });

  it("parses 'negotiate <task>/<sprint>' slash syntax", () => {
    const result = parseCliArgs(["negotiate", "auth/sprint-01"]);
    expect(result.type).toBe("negotiate");
    if (result.type === "negotiate") {
      expect(result.taskName).toBe("auth");
      expect(result.sprintId).toBe("sprint-01");
    }
  });

  it("parses 'execute <task> <sprint> --verbose'", () => {
    const result = parseCliArgs(["execute", "auth", "sprint-01", "--verbose"]);
    expect(result.type).toBe("execute");
    if (result.type === "execute") {
      expect(result.taskName).toBe("auth");
      expect(result.sprintId).toBe("sprint-01");
      expect(result.verbose).toBe(true);
    }
  });

  it("parses 'status <taskName>'", () => {
    const result = parseCliArgs(["status", "auth"]);
    expect(result.type).toBe("status");
    if (result.type === "status") {
      expect(result.taskName).toBe("auth");
    }
  });

  it("returns help for --help", () => {
    expect(parseCliArgs(["--help"])).toEqual({ type: "help" });
  });

  it("returns help for empty args", () => {
    expect(parseCliArgs([])).toEqual({ type: "help" });
  });

  it("backward compat: bare taskName without subcommand treated as run", () => {
    const result = parseCliArgs(["auth"]);
    expect(result.type).toBe("run");
    if (result.type === "run") {
      expect(result.taskName).toBe("auth");
      expect(result.verbose).toBe(false);
    }
  });
});

describe("runtime constants defaults", () => {
  it("MAX_SPRINTS defaults to 20", () => {
    expect(MAX_SPRINTS).toBe(20);
  });

  it("MAX_RETRIES defaults to 3", () => {
    expect(MAX_RETRIES).toBe(3);
  });

  it("MAX_NEGOTIATION_ROUNDS defaults to 5", () => {
    expect(MAX_NEGOTIATION_ROUNDS).toBe(5);
  });
});
