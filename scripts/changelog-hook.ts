import { spawnSync } from "node:child_process";

const COMMIT = /\bgit\b(?:\s+-C\s+("[^"]*"|\S+))?[^|;&\n]*?\bcommit\b/;
const QUIET = /^(tests|design|\.claude|eval)\/|^[^/]+\.md$|^(biome|tsconfig|playwright\.config|vite\.config)\b/;
export const SKIP = "[no changelog]";

export const REMINDER = `CHANGELOG.md is not in this commit. Update its « ## Unreleased » section first (French, for the team):
- if the change touches something a line already says (the same feature, a fix of a listed change), rewrite that line instead of adding one; remove a line it makes false;
- otherwise add one line: brief, simple, clear — what the team sees or can now do, not how it is built (no file, command or test names);
then git add CHANGELOG.md and commit again. A change the team cannot see (refactor, tests, tooling only): put ${SKIP} in the commit message.`;

// ponytail: a commit (git commit, -a too) is let through when CHANGELOG.md is in it, when it says [no changelog], or
// when it only touches what the team never sees (tests, design, docs, tooling config); otherwise the reminder
export function verdict(command: string, files: string[]): "allow" | "remind" {
  if (!COMMIT.test(command) || command.includes(SKIP)) return "allow";
  if (!files.length || files.includes("CHANGELOG.md")) return "allow";
  return files.every((f) => QUIET.test(f)) ? "allow" : "remind";
}

function committed(command: string, cwd: string): string[] {
  const dir = COMMIT.exec(command)?.[1]?.replace(/^"|"$/g, "") || cwd;
  const all = /\scommit\b[^|;&\n]*\s(-a\b|--all\b|-[a-zA-Z]*a[a-zA-Z]*\b)/.test(command);
  const git = (args: string[]) =>
    (spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" }).stdout ?? "").split(/\r?\n/).filter(Boolean);
  return [...new Set([...git(["diff", "--cached", "--name-only"]), ...(all ? git(["diff", "--name-only"]) : [])])];
}

// ponytail: a Claude Code PreToolUse hook on Bash and PowerShell (.claude/settings.json): exit 2 stops the commit and
// hands the reminder to Claude
if (import.meta.main) {
  let raw = "";
  process.stdin.on("data", (d) => {
    raw += d;
  });
  process.stdin.on("end", () => {
    let input: { tool_input?: { command?: unknown }; cwd?: unknown } = {};
    try {
      input = JSON.parse(raw);
    } catch {
      return;
    }
    const command = typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
    if (!COMMIT.test(command)) return;
    const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
    if (verdict(command, committed(command, cwd)) === "allow") return;
    process.stderr.write(`${REMINDER}\n`);
    process.exitCode = 2;
  });
}
