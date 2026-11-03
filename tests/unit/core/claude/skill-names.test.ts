import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registry } from "../../../../src/core/commands/index.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const SKILLS = join(ROOT, "templates", "project", ".claude", "skills");
const PROMPTS = join(ROOT, "src", "core", "claude");

// ponytail: review_note is a test.md frontmatter field, not a command
const tools = new Set([...registry.map((c) => c.name.replace(".", "_")), "review_note"]);
const GROUPS = new Set(registry.map((c) => c.name.split(".")[0]));

// ponytail: a name like docs_convert or mcp__testimus__docs_convert — a group of the registry, an underscore, a verb
function named(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(?:mcp__testimus__)?([a-z]+)_([a-z][A-Za-z]*)\b/g))
    if (GROUPS.has(m[1])) out.add(`${m[1]}_${m[2]}`);
  return [...out];
}

const files = [
  ...readdirSync(SKILLS).map((d) => join(SKILLS, d, "SKILL.md")),
  ...readdirSync(PROMPTS)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(PROMPTS, f)),
];

describe("the product skills and the Claude prompts name commands that exist (decision 7)", () => {
  for (const f of files)
    it(f.slice(ROOT.length + 1), () => {
      expect(named(readFileSync(f, "utf8")).filter((n) => !tools.has(n))).toEqual([]);
    });
});
