import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { quietCtx } from "../../../../src/core/command.ts";
import { commands } from "../../../../src/core/commands/project.ts";
import { startJob } from "../../../../src/core/jobs.ts";
import { readProject, readSettings, writeSettings } from "../../../../src/core/lib/project.ts";
import { projectOverview } from "../../../../src/core/lib/project-info.ts";
import { initProject } from "../../../../src/core/lib/project-init.ts";
import { rulesHash, shipSkills, splitRules, templateDir } from "../../../../src/core/lib/shipped.ts";
import { copyFixture, tempRoot } from "../../helpers/faces.ts";

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
    shipped[skill] = [createHash("sha256").update(older).digest("hex"), ...(shipped[skill] ?? [])];
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
    expect(r.created).toEqual(expect.arrayContaining(["project.json", "xray.json", "docs/", "tests/", "CLAUDE.md"]));
    const again = initProject(dir, {});
    expect(again.kept).toEqual(["project.json", "xray.json"]);
    expect(again.created).toEqual([]);
    expect(again.beside).toEqual([]);
  });
});

describe("shipSkills", () => {
  const GEN = ".claude/skills/generate-tests/SKILL.md";
  const OLD = "an older generate-tests: a test that grows past 15 steps is split.";
  const shippedFile = () => join(project, ".testimus", "shipped.json");
  const olderShipped = () => {
    initProject(project, {});
    const shipped = JSON.parse(readFileSync(shippedFile(), "utf8")) as Record<string, string[]>;
    shipped[GEN] = [createHash("sha256").update(OLD).digest("hex")];
    writeFileSync(shippedFile(), JSON.stringify(shipped));
    writeFileSync(join(project, GEN), OLD);
  };

  it("brings a skill an older Testimus shipped up to this version, and touches nothing else of the project", () => {
    olderShipped();
    const before = readFileSync(join(project, "project.json"), "utf8");
    const mcp = readFileSync(join(project, ".mcp.json"), "utf8");
    const r = shipSkills(project);
    expect(r).toEqual({ created: [], kept: [], beside: [] });
    expect(readFileSync(join(project, GEN))).toEqual(readFileSync(join(templateDir(), GEN)));
    expect(readFileSync(join(project, "CLAUDE.md"))).toEqual(readFileSync(join(templateDir(), "CLAUDE.md")));
    expect(readFileSync(join(project, "project.json"), "utf8")).toBe(before);
    expect(readFileSync(join(project, ".mcp.json"), "utf8")).toBe(mcp);
    expect(shipSkills(project)).toEqual({ created: [], kept: [], beside: [] });
  });

  const ledger = () => JSON.parse(readFileSync(shippedFile(), "utf8")) as Record<string, string[] | string>;
  const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
  const DRAFT = ".claude/skills/draft-comment/SKILL.md";

  describe("the rules of CLAUDE.md follow the app, the team's notes are kept", () => {
    const RULES = "CLAUDE.md";
    const rulesFile = () => join(project, RULES);
    const template = () => readFileSync(join(templateDir(), RULES), "utf8");
    const OLD_RULES = "# Testimus project\n\nAn older rule: cite the page.\n\n";
    const NOTES = "## Team notes\n\nLe PCC est le poste de commande centralisé.\n";
    const olderRules = (notes: string) => {
      initProject(project, {});
      const known = ledger();
      known[RULES] = [rulesHash(OLD_RULES), ...(known[RULES] as string[])];
      writeFileSync(shippedFile(), JSON.stringify(known));
      writeFileSync(rulesFile(), `${OLD_RULES}${notes}`);
    };

    it("the part above « Team notes » is the rules, the rest the team's; a file without the heading is all rules", () => {
      expect(splitRules(`${OLD_RULES}${NOTES}`)).toEqual({ rules: OLD_RULES, notes: NOTES });
      expect(splitRules("# Rules\r\n\r\n## Team notes\r\nA\r\n")).toEqual({
        rules: "# Rules\n\n",
        notes: "## Team notes\nA\n",
      });
      expect(splitRules(OLD_RULES)).toEqual({ rules: OLD_RULES, notes: "" });
      expect(splitRules("# Rules\n\n### Team notes\n").notes).toBe("");
      expect(splitRules(template()).notes).toMatch(/^## Team notes\n/);
    });

    it("the rules are known by their own hash: notes the team wrote never make them look edited", () => {
      expect(rulesHash(`${OLD_RULES}${NOTES}`)).toBe(rulesHash(OLD_RULES));
      expect(rulesHash(`${OLD_RULES.trimEnd()}\r\n\r\n\r\n${NOTES}`)).toBe(rulesHash(OLD_RULES));
      expect(rulesHash(`${OLD_RULES}One more rule.\n${NOTES}`)).not.toBe(rulesHash(OLD_RULES));
      expect(rulesHash(OLD_RULES)).toMatch(/^[0-9a-f]{16}$/);

      initProject(project, {});
      const mine = `${splitRules(template()).rules}${NOTES}`;
      writeFileSync(rulesFile(), mine);
      expect(shipSkills(project)).toEqual({ created: [], kept: [], beside: [] });
      expect(readFileSync(rulesFile(), "utf8")).toBe(mine);
      expect(existsSync(join(project, "CLAUDE.new.md"))).toBe(false);
    });

    it("rules an older Testimus shipped are replaced by this version's, the notes below as the team left them", () => {
      olderRules(NOTES);
      expect(shipSkills(project)).toEqual({ created: [], kept: [], beside: [] });
      expect(readFileSync(rulesFile(), "utf8")).toBe(`${splitRules(template()).rules}${NOTES}`);
      expect(ledger()[RULES]).toContain(rulesHash(template()));
      expect(shipSkills(project)).toEqual({ created: [], kept: [], beside: [] });
    });

    it("an older file without notes gets this version whole, its empty « Team notes » too", () => {
      olderRules("");
      shipSkills(project);
      expect(readFileSync(rulesFile(), "utf8")).toBe(template().replace(/\r\n/g, "\n"));
    });

    it("rules the team edited stay as they are, and this version lands beside them", () => {
      initProject(project, {});
      const edited = `# Our own rules\n\nAlways cite the DMI.\n\n${NOTES}`;
      writeFileSync(rulesFile(), edited);
      expect(shipSkills(project)).toEqual({ created: [], kept: [RULES], beside: ["CLAUDE.new.md"] });
      expect(readFileSync(rulesFile(), "utf8")).toBe(edited);
      expect(readFileSync(join(project, "CLAUDE.new.md"), "utf8")).toBe(template());
    });

    it("a CLAUDE.md the team deleted stays gone for a run; project init writes it again", () => {
      initProject(project, {});
      rmSync(rulesFile());
      expect(shipSkills(project).created).toEqual([]);
      expect(existsSync(rulesFile())).toBe(false);
      expect(initProject(project, {}).created).toContain(RULES);
      expect(readFileSync(rulesFile(), "utf8")).toBe(template());
    });
  });

  it("keeps a skill the team edited and writes this version beside it; adds a skill never shipped to the project", () => {
    olderShipped();
    writeFileSync(join(project, GEN), "the team's own generate-tests");
    rmSync(join(project, ".claude", "skills", "draft-comment"), { recursive: true });
    const { [DRAFT]: _, ...rest } = ledger();
    writeFileSync(shippedFile(), JSON.stringify(rest));
    const r = shipSkills(project);
    expect(r.kept).toEqual([GEN]);
    expect(r.beside).toEqual([".claude/skills/generate-tests/SKILL.new.md"]);
    expect(r.created).toEqual([".claude/skills/draft-comment/SKILL.md"]);
    expect(readFileSync(join(project, GEN), "utf8")).toBe("the team's own generate-tests");
    expect(readFileSync(join(project, ".claude/skills/generate-tests/SKILL.new.md"))).toEqual(
      readFileSync(join(templateDir(), GEN)),
    );
  });

  it("never brings back a version a newer build already moved past", () => {
    initProject(project, {});
    const newer = `${readFileSync(join(templateDir(), GEN), "utf8")}\nA newer Testimus's rule.\n`;
    writeFileSync(join(project, GEN), newer);
    const known = ledger();
    known[GEN] = [...(known[GEN] as string[]), hash(newer)];
    writeFileSync(shippedFile(), JSON.stringify(known));
    expect(shipSkills(project)).toEqual({ created: [], kept: [], beside: [] });
    expect(readFileSync(join(project, GEN), "utf8")).toBe(newer);
  });

  it("brings forward a version shipped before this one, even when this one was shipped already", () => {
    initProject(project, {});
    const known = ledger();
    known[GEN] = [hash(OLD), ...(known[GEN] as string[])];
    writeFileSync(shippedFile(), JSON.stringify(known));
    writeFileSync(join(project, GEN), OLD);
    shipSkills(project);
    expect(readFileSync(join(project, GEN))).toEqual(readFileSync(join(templateDir(), GEN)));
  });

  it("leaves every shipped file alone when a newer Testimus shipped to the project", () => {
    olderShipped();
    rmSync(join(project, ".claude", "skills", "draft-comment"), { recursive: true });
    const { [DRAFT]: _, ...rest } = ledger();
    writeFileSync(shippedFile(), JSON.stringify({ ...rest, app: "999.0.0" }));
    expect(shipSkills(project)).toEqual({ created: [], kept: [], beside: [] });
    expect(readFileSync(join(project, GEN), "utf8")).toBe(OLD);
    expect(existsSync(join(project, DRAFT))).toBe(false);
    expect(ledger().app).toBe("999.0.0");
  });

  it("records the newest Testimus that shipped here", () => {
    initProject(project, {});
    const app = (
      JSON.parse(readFileSync(join(templateDir(), "..", "..", "package.json"), "utf8")) as { version: string }
    ).version;
    expect(ledger().app).toBe(app);
  });

  it("does not bring back a skill the team deleted; project init does", () => {
    initProject(project, {});
    rmSync(join(project, ".claude", "skills", "draft-comment"), { recursive: true });
    expect(shipSkills(project).created).toEqual([]);
    expect(existsSync(join(project, DRAFT))).toBe(false);
    expect(initProject(project, {}).created).toContain(DRAFT);
    expect(readFileSync(join(project, DRAFT))).toEqual(readFileSync(join(templateDir(), DRAFT)));
  });
});

describe("projectOverview", () => {
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
    const info = projectOverview(project);
    expect(info.counts.tests).toBe(5);
    expect(info.counts.review.draft).toBe(3);
  });

  it("answers for a project without tests or docs folders", () => {
    const bare = join(tempRoot("project-bare"), "bare");
    mkdirSync(bare, { recursive: true });
    writeFileSync(join(bare, "project.json"), JSON.stringify({ name: "b", jiraProject: "B" }));
    expect(projectOverview(bare).counts).toMatchObject({ tests: 0, docs: 0, jobsRunning: 0 });
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

  it("forgets a known project and keeps its folder", async () => {
    const other = copyFixture(tempRoot("project-other"));
    writeSettings({ ...readSettings(), projects: [other, project], lastProject: other });
    expect(await run("project.forget", { dir: other })).toMatchObject({ forgotten: true });
    expect(readSettings()).toMatchObject({ projects: [project], lastProject: "" });
    expect(existsSync(join(other, "project.json"))).toBe(true);
    expect((await run("project.forget", { dir: other })).forgotten).toBe(false);
  });

  it("deletes a known project folder and forgets it", async () => {
    const other = copyFixture(tempRoot("project-del"));
    writeSettings({ ...readSettings(), projects: [other, project], lastProject: project });
    expect(await run("project.delete", { dir: other })).toMatchObject({ deleted: true });
    expect(existsSync(other)).toBe(false);
    expect(readSettings()).toMatchObject({ projects: [project], lastProject: project });
  });

  it("deletes the open project", async () => {
    writeSettings({ ...readSettings(), projects: [project], lastProject: project });
    expect(await run("project.delete", { dir: project })).toMatchObject({ deleted: true });
    expect(existsSync(project)).toBe(false);
    expect(readSettings()).toMatchObject({ projects: [], lastProject: "" });
  });

  it("waits for a job running in the project, not for a model download", async () => {
    writeSettings({ ...readSettings(), projects: [project] });
    let endIndex = () => {};
    let endPull = () => {};
    const index = startJob("rag-index", "all", project, () => new Promise<void>((r) => (endIndex = r)));
    const pull = startJob("models-pull", "bge", null, () => new Promise<void>((r) => (endPull = r)));
    await expect(run("project.delete", { dir: project })).rejects.toThrow("A job is running");
    endIndex();
    await index.done;
    expect(await run("project.delete", { dir: project })).toMatchObject({ deleted: true });
    endPull();
    await pull.done;
  });

  it("forgets a known project whose folder is gone", async () => {
    const gone = join(tempRoot("project-gone"), "gone");
    writeSettings({ ...readSettings(), projects: [gone, project], lastProject: gone });
    expect(await run("project.delete", { dir: gone })).toMatchObject({ deleted: false });
    expect(readSettings()).toMatchObject({ projects: [project], lastProject: "" });
  });

  it("refuses to delete an unknown folder or a folder that is not a project", async () => {
    const plain = join(tempRoot("project-plain"), "plain");
    mkdirSync(plain, { recursive: true });
    const stranger = copyFixture(tempRoot("project-stranger"));
    writeSettings({ ...readSettings(), projects: [project, plain] });
    await expect(run("project.delete", { dir: stranger })).rejects.toThrow("is not a known project");
    await expect(run("project.delete", { dir: plain })).rejects.toThrow("is not a Testimus project");
    expect(existsSync(plain)).toBe(true);
    expect(existsSync(join(stranger, "project.json"))).toBe(true);
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

  it("sets glossary, retrieval and reference, and removes them", async () => {
    const set = await run("project.set", {
      glossary: { TK: "télécommande" },
      rag: {
        queryTask: "Find",
        passageMaxChars: 2000,
        retrieval: { candidates: 40 },
        claudeHeaders: true,
        describeFigures: false,
        reference: { pack: "light" },
      },
      claude: { model: "opus", contexts: ["c1"] },
    });
    expect(set).toMatchObject({
      glossary: { TK: "télécommande" },
      rag: { queryTask: "Find", passageMaxChars: 2000, claudeHeaders: true, describeFigures: false },
    });
    expect(set.rag.retrieval.candidates).toBe(40);
    expect(set.rag.reference).toEqual({ pack: "light" });
    const cleared = await run("project.set", { rag: { reference: null } });
    expect(cleared.rag.reference).toBeUndefined();
    expect(cleared.rag.claudeHeaders).toBe(true);
  });
});
