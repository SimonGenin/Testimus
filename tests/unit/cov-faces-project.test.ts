import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { quietCtx } from "../../src/core/command.ts";
import { commands, initProject, projectInfo, templateDir } from "../../src/core/commands/project.ts";
import { readProject, readSettings, writeSettings } from "../../src/core/lib/project.ts";
import { copyFixture, tempRoot } from "./cov-faces-helpers.ts";

let project = "";
const run = async (name: string, raw: unknown = {}): Promise<any> => {
  const c = commands.find((x) => x.name === name);
  if (!c) throw new Error(`no ${name}`);
  return c.run(quietCtx(project), c.input.parse(raw) as never);
};

beforeEach(() => {
  project = copyFixture(tempRoot("project"));
});

function firstSkill(): string {
  const skills = join(templateDir(), ".claude", "skills");
  const name = readdirSync(skills)[0];
  const dir = join(skills, name);
  const file = readdirSync(dir).find((f) => f.endsWith(".md")) ?? "SKILL.md";
  return `.claude/skills/${name}/${file}`;
}

describe("initProject", () => {
  it("writes a shipped file the team edited beside it, and refreshes one it did not", () => {
    const first = initProject(project, {});
    expect(first.created).toContain(firstSkill());
    const skill = firstSkill();
    writeFileSync(join(project, skill), "team version");
    const second = initProject(project, { name: "Renamed" });
    const next = skill.replace(/(\.[^./]+)?$/, ".new$1");
    expect(second.beside).toEqual([next]);
    expect(second.kept).toContain(skill);
    expect(readFileSync(join(project, skill), "utf8")).toBe("team version");
    expect(existsSync(join(project, next))).toBe(true);
    expect(readProject(project).name).toBe("Renamed");
    const shipped = JSON.parse(readFileSync(join(project, ".testimus", "shipped.json"), "utf8")) as Record<
      string,
      string[]
    >;
    const older = "an older shipped version";
    shipped[skill] = [...(shipped[skill] ?? []), createHash("sha256").update(older).digest("hex")];
    writeFileSync(join(project, ".testimus", "shipped.json"), JSON.stringify(shipped));
    writeFileSync(join(project, skill), older);
    expect(initProject(project, {}).beside).toEqual([]);
    expect(readFileSync(join(project, skill))).toEqual(readFileSync(join(templateDir(), skill)));
    rmSync(join(project, ".testimus", "shipped.json"));
    writeFileSync(join(project, skill), "edited, nothing shipped known");
    expect(initProject(project, {}).beside).toEqual([next]);
  });

  it("leaves the name and key of a new project empty when none is given", () => {
    const dir = join(tempRoot("project-new"), "nameless");
    initProject(dir, {});
    expect(readProject(dir)).toMatchObject({ name: "", jiraProject: "" });
  });

  it("takes the Jira key as the name of a new project and creates its folders", () => {
    const dir = join(tempRoot("project-new"), "fresh");
    const r = initProject(dir, { jiraProject: "ABC" });
    expect(readProject(dir)).toMatchObject({ name: "ABC", jiraProject: "ABC" });
    expect(r.created).toEqual(expect.arrayContaining(["project.json", "xray.json", "docs/", "tests/"]));
    const again = initProject(dir, {});
    expect(again.kept).toEqual(expect.arrayContaining(["project.json", "xray.json", "CLAUDE.md"]));
  });
});

describe("projectInfo", () => {
  it("counts only test folders with a test.md, an unknown review as draft", () => {
    mkdirSync(join(project, "tests", "empty-folder"), { recursive: true });
    mkdirSync(join(project, "tests", "local-0000000e"), { recursive: true });
    writeFileSync(join(project, "tests", "local-0000000e", "test.md"), "---\nreview: weird\n---\n");
    mkdirSync(join(project, "tests", "local-0000000f"), { recursive: true });
    writeFileSync(join(project, "tests", "local-0000000f", "test.md"), "no front matter");
    mkdirSync(join(project, ".testimus", "jobs"), { recursive: true });
    writeFileSync(
      join(project, ".testimus", "jobs", "old-1.jsonl"),
      JSON.stringify({
        jobId: "old-1",
        at: "x",
        type: "status",
        job: { id: "old-1", kind: "k", subject: "s", status: "done", startedAt: "x" },
      }),
    );
    const info = projectInfo(project);
    expect(info.counts.tests).toBe(5);
    expect(info.counts.review.draft).toBe(2);
  });

  it("answers for a project without tests or docs folders", () => {
    const bare = join(tempRoot("project-bare"), "bare");
    mkdirSync(bare, { recursive: true });
    writeFileSync(join(bare, "project.json"), JSON.stringify({ name: "b", jiraProject: "B" }));
    expect(projectInfo(bare).counts).toMatchObject({ tests: 0, docs: 0, jobsRunning: 0 });
  });
});

describe("project commands", () => {
  it("lists a remembered folder that is no longer a project", async () => {
    const gone = join(tempRoot("project-gone"), "gone");
    writeSettings({ ...readSettings(), projects: [gone, project] });
    const r = await run("project.list");
    expect(r.projects[0]).toMatchObject({ dir: gone, exists: false });
    expect(r.projects[1]).toMatchObject({ dir: project, exists: true });
  });

  it("reads and writes the project notes", async () => {
    expect((await run("project.notes")).text).toBe("");
    const w = await run("project.setNotes", { text: "Règle é" });
    expect(w.bytes).toBe(Buffer.byteLength("Règle é"));
    expect((await run("project.notes")).text).toBe("Règle é");
  });

  it("refuses a label prefix that is empty or has spaces", async () => {
    await expect(run("project.set", { labelPrefix: " " })).rejects.toThrow("Not a label prefix");
    await expect(run("project.set", { labelPrefix: "a b" })).rejects.toThrow("Not a label prefix");
  });

  it("sets glossary, retrieval, reference and matrix, and removes them", async () => {
    const set = await run("project.set", {
      glossary: { TK: "télécommande" },
      rag: {
        queryTask: "Find",
        passageMaxChars: 2000,
        retrieval: { candidates: 40 },
        reranker: null,
        claudeHeaders: true,
        describeFigures: false,
        reference: { pack: "light" },
      },
      requirementMatrix: { idColumn: "Code", sectionColumn: "Section" },
      claude: { model: "opus", contexts: ["c1"] },
    });
    expect(set).toMatchObject({
      glossary: { TK: "télécommande" },
      rag: { queryTask: "Find", passageMaxChars: 2000, reranker: null, claudeHeaders: true, describeFigures: false },
      requirementMatrix: { idColumn: "Code", sectionColumn: "Section" },
    });
    expect(set.rag.retrieval.candidates).toBe(40);
    expect(set.rag.reference).toEqual({ pack: "light" });
    const cleared = await run("project.set", { rag: { reference: null }, requirementMatrix: null });
    expect(cleared.rag.reference).toBeUndefined();
    expect(cleared.requirementMatrix).toBeUndefined();
    expect(cleared.rag.claudeHeaders).toBe(true);
  });
});
