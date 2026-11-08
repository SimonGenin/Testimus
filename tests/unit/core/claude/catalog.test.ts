import { cpSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILT } from "../../../../src/core/claude/catalog.ts";
import { contextDir } from "../../../../src/core/claude/prompt.ts";
import { readProject, writeProject } from "../../../../src/core/lib/project.ts";
import { templateDir } from "../../../../src/core/lib/project-init.ts";
import { writeContextMd } from "../../helpers/context.ts";
import { call } from "../registry.ts";
import { dir } from "./run-fakes.ts";

type Given = {
  id: string;
  name: string;
  group: string;
  origin: string;
  path?: string;
  file?: string;
  usedBy: string[];
  text: string;
};

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const CORE = join(ROOT, "src", "core");
// ponytail: run.ts is the runner every prompt goes through and env.ts the seam it spawns with; the mock only answers
const RUNNERS = new Set(["claude/run.ts", "env.ts"]);

const sources = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    if (statSync(p).isDirectory()) return f === "mock" ? [] : sources(p);
    return f.endsWith(".ts") ? [p] : [];
  });

const callers = sources(CORE)
  .map((f) => relative(CORE, f).replaceAll("\\", "/"))
  .filter((f) => !RUNNERS.has(f) && /\b(runClaude|spawnClaude)\(/.test(readFileSync(join(CORE, f), "utf8")));

function project(): string {
  cpSync(join(templateDir(), ".claude"), join(dir, ".claude"), { recursive: true });
  cpSync(join(templateDir(), "CLAUDE.md"), join(dir, "CLAUDE.md"));
  writeContextMd(contextDir(dir, "glossary"), { name: "RATP glossary", notes: "TCO: poste de commande." });
  writeProject(dir, { ...readProject(dir), claude: { ...readProject(dir).claude, contexts: ["glossary", "gone"] } });
  return dir;
}

describe("claude.prompts lists everything Claude is given", () => {
  it("every module of src/core that runs claude -p has its prompts in the list", async () => {
    expect(callers.length).toBeGreaterThan(10);
    const ids = new Set(BUILT.map((t) => t.id));
    for (const f of callers) {
      const m = (await import(pathToFileURL(join(CORE, f)).href)) as { prompts?: { id: string }[] };
      expect(m.prompts?.length, `${f} runs claude -p: it exports its prompts`).toBeGreaterThan(0);
      for (const t of m.prompts ?? []) expect(ids.has(t.id), `${f}: ${t.id} is in claude.prompts`).toBe(true);
    }
    expect(new Set(BUILT.map((t) => t.id)).size).toBe(BUILT.length);
  });

  it("the skills of the project with what uses them, the team's own, CLAUDE.md, the default contexts, each built prompt", async () => {
    const out = await call<Given[]>("claude.prompts", {}, project());
    const by = (id: string) => out.find((p) => p.id === id) as Given;
    expect(new Set(out.map((p) => p.id)).size).toBe(out.length);

    const gen = by("skill:generate-tests");
    expect(gen).toMatchObject({ name: "Generate tests", group: "Generation", origin: "skill" });
    expect(gen.path).toBe(".claude/skills/generate-tests/SKILL.md");
    expect(gen.text).toBe(readFileSync(join(dir, ".claude", "skills", "generate-tests", "SKILL.md"), "utf8"));
    expect(gen.usedBy).toContain("gen.tests");
    expect(by("skill:plan-tests").group).toBe("Generation");
    expect(by("skill:check-test").group).toBe("Check and fix");
    expect(by("skill:edit-test").usedBy).toContain("claude.run");
    expect(by("skill:ask-docs").group).toBe("Chat");
    expect(by("skill:study-document").group).toBe("Documents");
    expect(by("skill:draft-comment").group).toBe("Jira");
    expect(by("skill:define-columns").group).toBe("Smart columns");
    expect(by("skill:house-style")).toMatchObject({ name: "House style", group: "Team skills", origin: "skill" });
    expect(by("skill:house-style").text).toContain("One ◼ bullet per gesture");

    expect(by("file:CLAUDE.md")).toMatchObject({ name: "Project rules", group: "Every run", origin: "file" });
    expect(by("file:CLAUDE.md").file).toBe(join(dir, "CLAUDE.md"));
    expect(by("context:glossary")).toMatchObject({
      name: "RATP glossary",
      origin: "context",
      path: "contexts/glossary/context.md",
    });
    expect(by("context:glossary").text).toContain("TCO: poste de commande.");
    expect(out.some((p) => p.id === "context:gone")).toBe(false);

    for (const t of BUILT) expect(by(t.id)).toMatchObject({ origin: "built", name: t.name, text: t.text() });
    expect(by("generate").path).toBeUndefined();
    expect(by("generate").text).toContain("Request: {request}");
    expect(by("generate").text).toContain("{contexts}");
    expect(by("ask-step").text).toMatch(
      /^Use the edit-test skill for the request below\.\nScope: step \{step\} of test \{test\}\./,
    );
    expect(by("contexts").text).toContain("Additional context from the user for this run:\n{note}");
  });

  it("is in the groups' order, the skills first in a group", async () => {
    const out = await call<Given[]>("claude.prompts", {}, project());
    const groups = [...new Set(out.map((p) => p.group))];
    expect(groups).toEqual([
      "Generation",
      "Check and fix",
      "Tests",
      "Documents",
      "Chat",
      "Smart columns",
      "Jira",
      "Claude actions",
      "Team skills",
      "System check",
      "Every run",
    ]);
    expect(out.filter((p) => p.group === "Generation").map((p) => p.origin)).toEqual([
      "skill",
      "skill",
      "built",
      "built",
    ]);
    expect(out.filter((p) => p.group === "Every run").map((p) => p.id)).toEqual([
      "file:CLAUDE.md",
      "contexts",
      "context:glossary",
    ]);
  });

  it("a project without skills nor CLAUDE.md still lists what Testimus builds", async () => {
    rmSync(join(dir, ".claude"), { recursive: true, force: true });
    const out = await call<Given[]>("claude.prompts", {}, dir);
    expect(out.map((p) => p.origin).every((o) => o === "built")).toBe(true);
    expect(out.length).toBe(BUILT.length);
  });
});
