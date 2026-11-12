import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { runCommands } from "../../../../src/core/claude/access.ts";
import { BUILT } from "../../../../src/core/claude/catalog.ts";
import { GIVEN_SLOT, givenTemplate } from "../../../../src/core/claude/given.ts";
import { contextDir } from "../../../../src/core/claude/prompt.ts";
import { sha256 } from "../../../../src/core/lib/hash.ts";
import { readProject, writeProject } from "../../../../src/core/lib/project.ts";
import { templateDir } from "../../../../src/core/lib/shipped.ts";
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
  kind?: string;
  answers?: string;
  takes?: { overview: boolean; documents: boolean; contexts: string; tools: string[]; files: string[] };
};

const SLOT = GIVEN_SLOT[1];

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

const all = sources(CORE).map((f) => relative(CORE, f).replaceAll("\\", "/"));
const text = (f: string) => readFileSync(join(CORE, f), "utf8");
const callers = all.filter((f) => !RUNNERS.has(f) && /\b(runClaude|spawnClaude)\(/.test(text(f)));
// ponytail: a module that runs claude -p through another one (generateTests, runOnScope, triage…) — the commands only
// hand their input over, so they are left out; each such module names the prompts it causes (promptsUsed)
const runners = callers.flatMap((f) => [...text(f).matchAll(/^export async function (\w+)/gm)].map((m) => m[1]));
const indirect = all.filter(
  (f) =>
    !f.startsWith("commands/") &&
    !RUNNERS.has(f) &&
    !callers.includes(f) &&
    runners.some((r) => new RegExp(`\\b${r}\\(`).test(text(f))),
);

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

  it("every module that runs claude -p through another names the prompts it causes, each in the list", async () => {
    expect(indirect).toEqual(expect.arrayContaining(["claude/gen-revise.ts", "lib/docs-pipeline.ts"]));
    const ids = new Set(BUILT.map((t) => t.id));
    for (const f of indirect) {
      const m = (await import(pathToFileURL(join(CORE, f)).href)) as { promptsUsed?: string[] };
      expect(
        m.promptsUsed?.length,
        `${f} runs claude -p through another module: it exports promptsUsed`,
      ).toBeGreaterThan(0);
      for (const id of m.promptsUsed ?? []) expect(ids.has(id), `${f}: ${id} is in claude.prompts`).toBe(true);
    }
  });

  it("claude.run has a prompt for every scope it takes", () => {
    for (const kind of ["step", "test", "tests", "doc", "project"])
      expect(
        BUILT.some((t) => t.id === `ask-${kind}`),
        `ask-${kind}`,
      ).toBe(true);
  });

  it("a skill is shown as the next run sends it: an older shipped version is brought up first", async () => {
    const p = project();
    const skill = join(p, ".claude", "skills", "check-test", "SKILL.md");
    const old = "an older check-test\n";
    writeFileSync(skill, old);
    mkdirSync(join(p, ".testimus"), { recursive: true });
    writeFileSync(
      join(p, ".testimus", "shipped.json"),
      JSON.stringify({ ".claude/skills/check-test/SKILL.md": [sha256(Buffer.from(old))] }),
    );
    const out = await call<Given[]>("claude.prompts", {}, p);
    const shown = out.find((g) => g.id === "skill:check-test") as Given;
    expect(shown.text).toBe(readFileSync(join(templateDir(), ".claude", "skills", "check-test", "SKILL.md"), "utf8"));
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
    expect(by("generate").text).toContain(SLOT);
    expect(by("ask-step").text).toMatch(
      /^Use the edit-test skill for the request below\.\nScope: step \{step\} of test \{test\}\./,
    );
    expect(by("given")).toMatchObject({ name: "What goes with a run", group: "Every run", origin: "built" });
    expect(by("given").text).toBe(givenTemplate());
    expect(by("given").text).toContain("From the user, for this run only:\n{note}");
    expect(by("given").text).toContain("- {document}: {what the team wrote about it}");
    expect(by("triage").text).toContain("[job:{job}] {problem}");
    expect(by("triage").text).not.toContain(SLOT);
    expect(by("triage-doc").text).toContain(SLOT);
  });

  it("a built prompt says the kind of run that sends it, what goes with that kind and what it gives back", async () => {
    const out = await call<Given[]>("claude.prompts", {}, project());
    const by = (id: string) => out.find((p) => p.id === id) as Given;
    for (const t of BUILT) {
      expect(by(t.id).kind, t.id).toBe(t.kind);
      expect(by(t.id).answers, t.id).toBe(t.answers || undefined);
      expect(!!by(t.id).takes, t.id).toBe(!!t.kind);
    }
    expect(BUILT.filter((t) => !t.kind).map((t) => t.id)).toEqual(["sign-in", "doctor-sign-in", "given"]);
    expect(by("check").answers).toContain("check_record, once per test");
    expect(by("check").takes).toMatchObject({
      overview: true,
      documents: true,
      files: ["Read", "Glob", "Grep", "Skill"],
    });
    expect(by("check").takes?.tools).toEqual(runCommands("check").map((n) => n.replace(".", "_")));
    expect(by("check").takes?.tools).toContain("check_record");
    expect(by("check").takes?.tools).not.toContain("tests_edit");
    expect(by("figures").takes).toMatchObject({ overview: false, documents: false, tools: [], files: ["Read"] });
    expect(by("study").takes).toMatchObject({ overview: true, documents: false });
    expect(by("generate").takes?.contexts).toContain("unless the user picks others for the run");
    expect(by("skill:check-test").kind).toBeUndefined();
    expect(by("context:glossary").takes).toBeUndefined();
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
    expect(out.filter((p) => p.group === "Generation").map((p) => p.id)).toEqual([
      "skill:generate-tests",
      "skill:plan-tests",
      "generate",
      "generate-review",
      "generate-planned",
      "generate-add",
      "generate-replan",
    ]);
    expect(out.filter((p) => p.group === "Every run").map((p) => p.id)).toEqual([
      "file:CLAUDE.md",
      "given",
      "context:glossary",
    ]);
  });

  it("how the documents fit together: its skill, its two prompts, and the file while it is given to every run", async () => {
    const P = project();
    writeFileSync(join(P, "docs", "OVERVIEW.md"), "---\nbasis:\n---\n## Traction <!-- doc A -->\n");
    const p = readProject(P);
    writeProject(P, { ...p, claude: { ...p.claude, overview: { enabled: true, inEveryRun: true } } });
    const out = await call<Given[]>("claude.prompts", {}, P);
    const docs = out.filter((g) => g.group === "Documents").map((g) => g.id);
    expect(docs).toEqual(expect.arrayContaining(["skill:overview-documents", "overview-update", "overview-full"]));
    const every = out.filter((g) => g.group === "Every run").map((g) => g.id);
    expect(every.slice(0, 3)).toEqual(["file:CLAUDE.md", "file:docs/OVERVIEW.md", "given"]);
    expect(out.find((g) => g.id === "file:docs/OVERVIEW.md")?.usedBy[0]).toContain("a run may leave it out");
    expect(out.find((g) => g.id === "file:docs/OVERVIEW.md")?.text).toContain("<!-- doc A -->");
    writeProject(P, { ...p, claude: { ...p.claude, overview: { enabled: true, inEveryRun: false } } });
    const off = await call<Given[]>("claude.prompts", {}, P);
    expect(off.some((g) => g.id === "file:docs/OVERVIEW.md")).toBe(false);
  });

  it("a project whose team deleted the skills, without CLAUDE.md, still lists what Testimus builds", async () => {
    const shipped = Object.fromEntries([
      ...readdirSync(join(templateDir(), ".claude", "skills")).map((s) => [`.claude/skills/${s}/SKILL.md`, ["0"]]),
      ["CLAUDE.md", ["0"]],
    ]);
    mkdirSync(join(dir, ".testimus"), { recursive: true });
    writeFileSync(join(dir, ".testimus", "shipped.json"), JSON.stringify(shipped));
    rmSync(join(dir, ".claude"), { recursive: true, force: true });
    const out = await call<Given[]>("claude.prompts", {}, dir);
    expect(out.map((p) => p.origin).every((o) => o === "built")).toBe(true);
    expect(out.length).toBe(BUILT.length);
  });
});
