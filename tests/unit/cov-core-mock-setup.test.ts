import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { env } from "../../src/core/env.ts";
import { fixturesDir, setupMock } from "../../src/core/mock/index.ts";
import { mockHttp } from "../../src/core/mock/jira.ts";

const saved = { ...env };

afterAll(() => {
  Object.assign(env, saved);
  delete process.env.TESTIMUS_MOCK_INDEX;
});

describe("setupMock with a BM25-only index", () => {
  it("builds the sandbox, points every seam at it and indexes without a model", async () => {
    process.env.TESTIMUS_MOCK_INDEX = "bm25";
    const project = await setupMock();
    const root = join(project, "..");
    expect(env.mock).toBe(true);
    expect(env.homeDir()).toBe(join(root, "home"));
    expect(env.dataDir()).toBe(join(root, "appdata"));
    expect(env.localDir()).toBe(join(root, "localappdata"));
    expect(env.http).toBe(mockHttp);
    expect(existsSync(join(project, "project.json"))).toBe(true);
    expect(existsSync(join(env.homeDir(), ".atlassian", "credentials.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(env.dataDir(), "settings.json"), "utf8")).lastProject).toBe(project);
    expect(existsSync(join(fixturesDir(), "project", "project.json"))).toBe(true);
  }, 60_000);
});
