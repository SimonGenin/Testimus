import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { env } from "../../../../src/core/env.ts";
import { DEFAULT_PROJECT, readProject, writeProject } from "../../../../src/core/lib/project.ts";
import { setupMock } from "../../../../src/core/mock/index.ts";

const saved = { ...env };

afterEach(() => {
  delete process.env.TESTIMUS_MOCK_SEED;
});

afterAll(() => {
  Object.assign(env, saved);
  delete process.env.TESTIMUS_MOCK_INDEX;
});

const settings = () =>
  JSON.parse(readFileSync(join(env.dataDir(), "settings.json"), "utf8")) as { projects: string[]; lastProject: string };

describe("TESTIMUS_MOCK_SEED", () => {
  it("none: no project at all, for the first run", async () => {
    process.env.TESTIMUS_MOCK_INDEX = "bm25";
    process.env.TESTIMUS_MOCK_SEED = "none";
    expect(await setupMock()).toBeNull();
    expect(settings().projects).toEqual([]);
  }, 60_000);

  it("empty, then a folder of this PC: the first is open, the folder is copied and left as it was", async () => {
    const real = join(mkdtempSync(join(tmpdir(), "testimus-seed-")), "Essai");
    mkdirSync(join(real, "tests"), { recursive: true });
    writeProject(real, { ...DEFAULT_PROJECT, name: "Essai" });
    writeFileSync(join(real, "tests", "note.txt"), "kept");
    const before = readFileSync(join(real, "project.json"), "utf8");
    process.env.TESTIMUS_MOCK_INDEX = "bm25";
    process.env.TESTIMUS_MOCK_SEED = `empty,${real}`;
    const project = (await setupMock()) ?? "";
    expect(basename(project)).toBe("Empty");
    const { projects, lastProject } = settings();
    expect(lastProject).toBe(project);
    expect(projects.map((p) => basename(p))).toEqual(["Empty", "Essai"]);
    expect(projects[1]).not.toBe(real);
    expect(readProject(project).jiraProject).toBe("");
    expect(readFileSync(join(projects[1], "tests", "note.txt"), "utf8")).toBe("kept");
    expect(readFileSync(join(real, "project.json"), "utf8")).toBe(before);
  }, 60_000);

  it("refuses a folder that is not a project", async () => {
    process.env.TESTIMUS_MOCK_SEED = mkdtempSync(join(tmpdir(), "testimus-seed-"));
    await expect(setupMock()).rejects.toThrow(/not a Testimus project/);
  });
});
