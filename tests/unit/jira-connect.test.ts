import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "../../src/core/commands/index.ts";
import { env, type HttpReq } from "../../src/core/env.ts";
import { resetAuth } from "../../src/core/lib/jira.ts";
import { readProject, writeProject } from "../../src/core/lib/project.ts";
import { checkRemote, projectInfo, pullToLocal } from "../../src/core/lib/sync.ts";
import { mockHttp, resetMockJira } from "../../src/core/mock/jira.ts";

const FIXTURE = new URL("../fixtures/project/", import.meta.url);
const http = env.http;
let project = "";
let asked: string[] = [];

afterAll(() => {
  env.http = http;
});

beforeEach(() => {
  project = join(mkdtempSync(join(tmpdir(), "testimus-connect-")), "LFRPS12");
  cpSync(FIXTURE, project, { recursive: true });
  rmSync(join(project, ".testimus", "jira-project.json"), { force: true });
  const dir = join(env.homeDir(), ".atlassian");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "credentials.json"),
    JSON.stringify({ baseUrl: "https://mock.atlassian.net", email: "tester@example.com", token: "t" }),
  );
  writeFileSync(join(dir, "xray_credentials.json"), JSON.stringify({ clientId: "id", clientSecret: "secret" }));
  resetMockJira();
  resetAuth();
  asked = [];
  env.http = async (req: HttpReq) => {
    asked.push(req.url);
    return mockHttp(req);
  };
});

const set = (p: { jiraProject?: string; jiraOffline?: boolean; name?: string }) =>
  writeProject(project, { ...readProject(project), ...p });
const run = (name: string, input: unknown = {}) => invoke(name, input, { project });

describe("xray.connect", () => {
  it("checks the key in Jira before saving it, and names the project after it when it had no name", async () => {
    set({ jiraProject: "", name: "" });
    await expect(projectInfo(project)).rejects.toThrow(/not connected to a Jira project/);
    expect(asked).toEqual([]);
    await expect(run("xray.connect", { key: "nope" })).rejects.toThrow(/NOPE not found/);
    expect(readProject(project).jiraProject).toBe("");
    expect(await run("xray.connect", { key: " lfrps12 " })).toMatchObject({ jiraProject: "LFRPS12" });
    expect(readProject(project)).toMatchObject({ jiraProject: "LFRPS12", name: "LFRPS12" });
    expect(existsSync(join(project, ".testimus", "jira-project.json"))).toBe(true);
  });

  it("refuses no key and a malformed one without asking Jira", async () => {
    set({ jiraProject: "" });
    await expect(run("xray.connect")).rejects.toThrow(/Which Jira project/);
    await expect(run("xray.connect", { key: "12 AB" })).rejects.toThrow(/not a Jira project key/);
    expect(asked).toEqual([]);
  });

  it("reconnects the key already set, ending a disconnection", async () => {
    set({ jiraOffline: true });
    await run("xray.connect");
    expect(readProject(project).jiraOffline).toBeUndefined();
    expect((await projectInfo(project)).key).toBe("LFRPS12");
  });
});

describe("xray.disconnect", () => {
  it("keeps the key and lets nothing reach Jira until a reconnect", async () => {
    expect(await run("xray.disconnect")).toEqual({ jiraProject: "LFRPS12" });
    expect(readProject(project)).toMatchObject({ jiraProject: "LFRPS12", jiraOffline: true });
    await expect(run("xray.folders")).rejects.toThrow(/Jira is disconnected/);
    await expect(run("xray.search", { text: "frein" })).rejects.toThrow(/Jira is disconnected/);
    await expect(pullToLocal(project, "LFRPS12-1420")).rejects.toThrow(/Jira is disconnected/);
    expect(await checkRemote(project, "LFRPS12-1420")).toBe("unverified");
    await expect(run("xray.plan", { id: "LFRPS12-1420" })).rejects.toThrow(/Jira is disconnected/);
    expect(asked).toEqual([]);
  });
});
