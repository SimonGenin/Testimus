import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REMINDER, verdict } from "../../../scripts/changelog-hook.ts";
import { changelogFor } from "../../../scripts/publish.ts";

const HOOK = join(import.meta.dirname, "..", "..", "..", "scripts", "changelog-hook.ts");

describe("the changelog hook", () => {
  it("lets through what is not a commit, a commit with the changelog, a [no changelog] one, or one only of tests and docs", () => {
    expect(verdict("git status", ["src/a.ts"])).toBe("allow");
    expect(verdict('git commit -m "x"', ["src/a.ts", "CHANGELOG.md"])).toBe("allow");
    expect(verdict('git commit -m "Refactor [no changelog]"', ["src/a.ts"])).toBe("allow");
    expect(verdict('git commit -m "x"', ["tests/unit/a.test.ts", "CODE.md", ".claude/settings.json"])).toBe("allow");
    expect(verdict('git commit -m "x"', [])).toBe("allow");
  });

  it("reminds a commit that changes the app without touching the changelog", () => {
    expect(verdict('git add -A && git commit -m "x"', ["src/ui/a.tsx", "tests/a.test.ts"])).toBe("remind");
    expect(verdict('git -C "D:/w" commit -am "x"', ["scripts/release.ts"])).toBe("remind");
    expect(REMINDER).toContain("rewrite that line instead of adding one");
  });

  it("runs as a PreToolUse hook: exit 2 with the reminder on a staged change, 0 otherwise", () => {
    const dir = mkdtempSync(join(tmpdir(), "testimus-hook-"));
    try {
      const git = (...args: string[]) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
      git("init", "-q");
      writeFileSync(join(dir, "app.ts"), "x");
      git("add", "app.ts");
      const hook = (command: string) =>
        spawnSync(process.execPath, [HOOK], {
          input: JSON.stringify({ tool_input: { command }, cwd: dir }),
          encoding: "utf8",
        });
      const blocked = hook('git commit -m "x"');
      expect(blocked.status).toBe(2);
      expect(blocked.stderr).toContain("CHANGELOG.md is not in this commit");
      expect(hook("git log").status).toBe(0);
      writeFileSync(join(dir, "CHANGELOG.md"), "## Unreleased\n\n- x\n");
      git("add", "CHANGELOG.md");
      expect(hook('git commit -m "x"').status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("publish and the changelog", () => {
  it("takes Unreleased (and --notes as one more line) for the version, its notes are those lines", () => {
    const out = changelogFor("# C\n\n## Unreleased\n\n- A.\n\n## 0.0.1\n\n- Old.\n", "0.0.2", "B.");
    expect(out.notes).toBe("- A.\n- B.");
    expect(out.text).toBe("# C\n\n## Unreleased\n\n## 0.0.2\n\n- A.\n- B.\n\n## 0.0.1\n\n- Old.\n");
    expect(() => changelogFor("## Unreleased\n\n## 0.0.1\n- Old.\n", "0.0.2", "")).toThrow("nothing under");
  });
});
