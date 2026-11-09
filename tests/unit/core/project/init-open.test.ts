import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { env } from "../../../../src/core/env.ts";
import { stepColumns } from "../../../../src/core/lib/columns.ts";
import { projectsRoot, readProject, readSettings, readXray, writeJson } from "../../../../src/core/lib/project.ts";
import { STARTER_ASKS } from "../../../../src/core/lib/project-init.ts";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/project/", import.meta.url));
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

describe("project.init", () => {
  it("copies the template, writes project.json, xray.json, the folders, and remembers the project", async () => {
    const dir = join(tmp("testimus-init-"), "Nouveau projet");
    const r = (await invoke(
      "project.init",
      { dir, jiraProject: "LFRPS12", name: "RATP Sosie" },
      { project: null },
    )) as {
      dir: string;
      created: string[];
      kept: string[];
    };
    expect(r.dir).toBe(dir);
    for (const f of [
      "CLAUDE.md",
      ".mcp.json",
      ".claude/skills/ask-docs/SKILL.md",
      "project.json",
      "xray.json",
      "docs/",
      "tests/",
      "contexts/",
    ])
      expect(r.created).toContain(f);
    expect(readProject(dir)).toMatchObject({ name: "RATP Sosie", jiraProject: "LFRPS12", language: "fr" });
    expect(readXray(dir).fields.map((f) => f.name)).toEqual(["Action", "Data", "Expected Result"]);
    const mcp = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.testimus.args.at(-1)).toBe("mcp");
    expect(readSettings().lastProject).toBe(dir);
    expect(readSettings().projects[0]).toBe(dir);
  });

  it("starts an empty folder with Data shown when filled and the starter quick asks", async () => {
    const dir = tmp("testimus-init-empty-");
    await invoke("project.init", { dir }, { project: null });
    const xray = JSON.parse(readFileSync(join(dir, "xray.json"), "utf8"));
    expect(xray.fields.map((f: { name: string }) => f.name)).toEqual(["Action", "Data", "Expected Result"]);
    expect(
      stepColumns(dir)
        .filter((c) => c.mode === "filled")
        .map((c) => c.name),
    ).toEqual(["Data"]);
    const project = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
    expect(project.claude.presets).toEqual(STARTER_ASKS);
    expect(project.claude.presets.map((p: { label: string }) => p.label)).toEqual([
      "One action per step",
      "Checkable results",
      "Missing cases",
    ]);
  });

  it("never overwrites the team's CLAUDE.md nor an existing project.json", async () => {
    const dir = tmp("testimus-reinit-");
    await invoke("project.init", { dir, jiraProject: "LFRPS12", language: "en" }, { project: null });
    writeFileSync(join(dir, "CLAUDE.md"), "# Team rules\n");
    const r = (await invoke("project.init", { dir, name: "Renamed" }, { project: null })) as { kept: string[] };
    expect(r.kept).toEqual(["CLAUDE.md", "project.json", "xray.json"]);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("# Team rules\n");
    expect(readProject(dir)).toMatchObject({ name: "Renamed", jiraProject: "LFRPS12", language: "en" });
  });
});

describe("projectsRoot", () => {
  it("is D:\\Testimus\\Projects, or C: when the PC has no D:", () => {
    if (process.platform !== "win32") return;
    expect(projectsRoot(() => true)).toBe("D:\\Testimus\\Projects");
    expect(projectsRoot(() => false)).toBe("C:\\Testimus\\Projects");
  });

  it("stays in the sandbox under --mock, and project.list hands it to the page", async () => {
    env.mock = true;
    try {
      expect(projectsRoot(() => true)).toBe(join(env.homeDir(), "Testimus", "Projects"));
      expect(((await invoke("project.list", {}, { project: null })) as { root: string }).root).toBe(
        join(env.homeDir(), "Testimus", "Projects"),
      );
    } finally {
      env.mock = false;
    }
  });

  it("is where project.openKey makes a project when none was opened before", async () => {
    const before = readSettings();
    writeJson(join(env.dataDir(), "settings.json"), { ...before, lastProject: "" });
    env.mock = true;
    try {
      const r = (await invoke("project.openKey", { key: "NEWKEY" }, { project: null })) as { dir: string };
      expect(r.dir).toBe(join(env.homeDir(), "Testimus", "Projects", "NEWKEY"));
    } finally {
      env.mock = false;
    }
  });
});

describe("project.openKey (Xray Editor's « Go » by Jira code)", () => {
  it("opens a known project by its key, else makes a new project folder named after it", async () => {
    const root = tmp("testimus-bykey-");
    const known = join(root, "Mine");
    cpSync(FIXTURE, known, { recursive: true });
    await invoke("project.open", { dir: known }, { project: null });
    const a = (await invoke("project.openKey", { key: "lfrps12" }, { project: null })) as {
      dir: string;
      created: boolean;
    };
    expect(a).toMatchObject({ dir: known, created: false });
    const b = (await invoke("project.openKey", { key: "bhptcc" }, { project: null })) as {
      dir: string;
      created: boolean;
      jiraProject: string;
    };
    expect(b).toMatchObject({ dir: join(root, "BHPTCC"), created: true, jiraProject: "BHPTCC" });
    expect(existsSync(join(root, "BHPTCC", "project.json"))).toBe(true);
    await expect(invoke("project.openKey", { key: "no such" }, { project: null })).rejects.toThrow(
      /not a Jira project key/,
    );
  });
});

describe("project.info / set / open / list", () => {
  it("counts docs, tests per review state and running jobs", async () => {
    const dir = join(tmp("testimus-info-"), "LFRPS12");
    cpSync(FIXTURE, dir, { recursive: true });
    const info = (await invoke("project.info", {}, { project: dir })) as {
      fieldOrder: string[];
      counts: { docs: number; tests: number; review: Record<string, number>; jobsRunning: number };
      project: { jiraProject: string };
    };
    expect(info.project.jiraProject).toBe("LFRPS12");
    expect(info.fieldOrder).toContain("Exigence");
    expect(info.counts.docs).toBe(5);
    expect(info.counts.tests).toBe(3);
    expect(Object.values(info.counts.review).reduce((a, b) => a + b, 0)).toBe(3);
    expect(info.counts.review.draft).toBeGreaterThanOrEqual(1);
    expect(info.counts.jobsRunning).toBe(0);
  });

  it("patches project.json field by field", async () => {
    const dir = tmp("testimus-set-");
    await invoke("project.init", { dir, jiraProject: "DEMO" }, { project: null });
    await invoke(
      "project.set",
      { language: "en", claude: { model: "opus", presets: [{ label: "L", prompt: "P" }] }, rag: { queryTask: "Find" } },
      { project: dir },
    );
    const p = readProject(dir);
    expect(p).toMatchObject({ jiraProject: "DEMO", language: "en", rag: { queryTask: "Find" } });
    expect(p.claude).toEqual({ model: "opus", effort: "high", presets: [{ label: "L", prompt: "P" }], contexts: [] });
  });

  it("opens a project folder and lists the known ones", async () => {
    const a = tmp("testimus-a-");
    const b = tmp("testimus-b-");
    await invoke("project.init", { dir: a, jiraProject: "AAA" }, { project: null });
    await invoke("project.init", { dir: b, jiraProject: "BBB" }, { project: null });
    expect(await invoke("project.open", { dir: a }, { project: null })).toMatchObject({ dir: a, jiraProject: "AAA" });
    const list = (await invoke("project.list", {}, { project: null })) as {
      last: string;
      projects: { dir: string; exists: boolean }[];
    };
    expect(list.last).toBe(a);
    expect(list.projects.slice(0, 2).map((p) => p.dir)).toEqual([a, b]);
    await expect(invoke("project.open", { dir: tmp("testimus-empty-") }, { project: null })).rejects.toThrow(
      /not a Testimus project/,
    );
    expect(existsSync(join(a, "project.json"))).toBe(true);
  });
});
