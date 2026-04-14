import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { isGitRepo } from "../../git.js";

describe("isGitRepo", () => {
  it("returns true for git repo", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-git-"));
    try {
      execSync("git init && git config user.email 'test@test.com' && git config user.name 'Test'", {
        cwd: dir, stdio: "ignore",
      });
      expect(isGitRepo(dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it("returns false for non-git directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-nogit-"));
    try {
      expect(isGitRepo(dir)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });
});
