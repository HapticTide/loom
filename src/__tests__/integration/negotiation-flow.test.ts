import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Runtimes } from "../../runtime.js";
import type { LoomConfig } from "../../types.js";
import { negotiateContract } from "../../negotiator.js";
import { createMockRuntime } from "./mock-runtime.js";

describe("negotiation flow (mock runtime)", () => {
  let tmpDir: string;
  let loomHome: string;
  let homedirSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    loomHome = fs.mkdtempSync(path.join(os.tmpdir(), "loom-home-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(loomHome);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-neg-flow-"));
    const sprintDir = path.join(tmpDir, "sprint-01");
    fs.mkdirSync(sprintDir, { recursive: true });
    fs.writeFileSync(
      path.join(sprintDir, "feature-spec.md"),
      "# Sprint 01: Test Feature\n\nBuild a test feature.",
    );
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
    if (loomHome && fs.existsSync(loomHome)) {
      fs.rmSync(loomHome, { recursive: true });
    }
  });

  function makeConfig(): LoomConfig {
    const runsDir = path.join(tmpDir, "runs");
    fs.mkdirSync(runsDir, { recursive: true });
    return {
      projectName: "test-project",
      taskName: "test-task",
      taskDir: tmpDir,
      projectRoot: tmpDir,
      runsDir,
      spec: "Test spec",
      roleFiles: {
        generator: "You are a generator.",
        evaluator: "You are an evaluator.",
      },
      designLanguage: "",

      verbose: false,
    };
  }

  it("single-round approval writes contract and negotiation files", async () => {
    const sprintDir = path.join(tmpDir, "sprint-01");
    const proposal = "# Contract\n## AC-01: Test\n- Command: echo ok\n- Expected: ok";

    const runtimes = {
      generator: createMockRuntime([{ response: proposal, exitCode: 0 }]),
      evaluator: createMockRuntime([
        { response: "All criteria are concrete.\n\n## Verdict: APPROVED", exitCode: 0 },
      ]),
    } as unknown as Runtimes;

    const config = makeConfig();
    const result = await negotiateContract(runtimes, sprintDir, config);

    expect(result.approved).toBe(true);
    expect(result.rounds).toBe(1);
    expect(result.forcedApproval).toBe(false);

    // contract.md contains the proposal (renamed from draft)
    const contract = fs.readFileSync(path.join(sprintDir, "contract.md"), "utf-8");
    expect(contract).toBe(proposal);

    // contract-draft.md should NOT exist anywhere (renamed to contract.md)
    expect(fs.existsSync(path.join(sprintDir, "contract-draft.md"))).toBe(false);
    const runsSprintDir = path.join(config.runsDir, path.basename(sprintDir));
    expect(fs.existsSync(path.join(runsSprintDir, "contract-draft.md"))).toBe(false);

    // negotiation history exists with incremental entries
    expect(fs.existsSync(path.join(sprintDir, "contract-negotiation.md"))).toBe(true);
    const history = fs.readFileSync(path.join(sprintDir, "contract-negotiation.md"), "utf-8");
    expect(history).toContain("Round 1: Proposal");
    expect(history).toContain("Round 1: Review");
  }, 10000);

  it("multi-round: REVISE then APPROVED uses latest proposal", async () => {
    const sprintDir = path.join(tmpDir, "sprint-01");
    const proposal1 = "# Contract v1\n## AC-01: Greeting";
    const proposal2 = "# Contract v2\n## AC-01: Greeting\n## AC-02: Name flag";

    const runtimes = {
      generator: createMockRuntime([
        { response: proposal1, exitCode: 0 },
        { response: proposal2, exitCode: 0 },
      ]),
      evaluator: createMockRuntime([
        {
          response: "Missing name flag AC.\n\n## Verdict: REVISE\n### Revision Reasons\n- Missing AC for --name flag",
          exitCode: 0,
        },
        { response: "All criteria met.\n\n## Verdict: APPROVED", exitCode: 0 },
      ]),
    } as unknown as Runtimes;

    const result = await negotiateContract(runtimes, sprintDir, makeConfig());

    expect(result.approved).toBe(true);
    expect(result.rounds).toBe(2);

    // contract.md should contain the second (revised) proposal
    const contract = fs.readFileSync(path.join(sprintDir, "contract.md"), "utf-8");
    expect(contract).toContain("Contract v2");
    expect(contract).toContain("AC-02");

    // negotiation history should contain both rounds
    const history = fs.readFileSync(path.join(sprintDir, "contract-negotiation.md"), "utf-8");
    expect(history).toContain("Round 1: Proposal");
    expect(history).toContain("Round 2: Proposal");
    expect(history).toContain("Round 2: Review");
  }, 10000);

  it("empty generator response throws error", async () => {
    const sprintDir = path.join(tmpDir, "sprint-01");

    const runtimes = {
      generator: createMockRuntime([{ response: "", exitCode: 0 }]),
      evaluator: createMockRuntime([]),
    } as unknown as Runtimes;

    await expect(
      negotiateContract(runtimes, sprintDir, makeConfig()),
    ).rejects.toThrow();
  }, 10000);
});
