import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../src/core/env.ts";
import { resetAuth } from "../../src/core/lib/jira.ts";
import { readXray } from "../../src/core/lib/project.ts";
import { readTest } from "../../src/core/lib/store.ts";
import {
  checkRemote,
  executePlan,
  freshXray,
  insideTest,
  type Push,
  pullToLocal,
  pushTest,
} from "../../src/core/lib/sync.ts";
import { serializeTest } from "../../src/core/lib/testfile.ts";
import { mockHttp, mockJira, mockJiraTest, resetMockJira } from "../../src/core/mock/jira.ts";

const FIXTURE = new URL("../fixtures/project/", import.meta.url);
const http = env.http;
let project = "";

afterAll(() => {
  env.http = http;
});

beforeEach(() => {
  project = join(mkdtempSync(join(tmpdir(), "testimus-covsync-")), "LFRPS12");
  cpSync(FIXTURE, project, { recursive: true });
  const dir = join(env.homeDir(), ".atlassian");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "credentials.json"),
    JSON.stringify({ baseUrl: "https://mock.atlassian.net", email: "tester@example.com", token: "t" }),
  );
  writeFileSync(join(dir, "xray_credentials.json"), JSON.stringify({ clientId: "id", clientSecret: "secret" }));
  resetMockJira();
  resetAuth();
  mockJira.maxAttachmentBytes = 10 * 1024 * 1024;
  env.http = mockHttp;
});

const images = (id: string) => readdirSync(join(project, "tests", id, "images"));

describe("freshXray and projectInfo", () => {
  it("reads the step fields once the project info is cached, keeps the local prefs, and falls back offline", async () => {
    const before = readXray(project).prefs;
    const { fields, prefs, fetchedAt } = await freshXray(project);
    expect(prefs).toEqual(before);
    expect(fetchedAt).toBeTruthy();
    expect(readXray(project).fetchedAt).toBe(fetchedAt);
    expect(fields.map((f) => f.name)).toEqual(["Action", "Data", "Expected Result", "Exigence"]);
    expect(existsSync(join(project, ".testimus", "jira-project.json"))).toBe(true);
    let projectCalls = 0;
    env.http = async (req) => {
      if (req.url.includes("/rest/api/3/project/")) projectCalls++;
      return mockHttp(req);
    };
    await freshXray(project);
    expect(projectCalls).toBe(0);
    env.http = async () => {
      throw new Error("offline");
    };
    expect((await freshXray(project)).fetchedAt).toBe(readXray(project).fetchedAt);
  });

  it("reads the step columns again before a push plan, so a column made required since warns", async () => {
    const first = (await freshXray(project)).fetchedAt ?? "";
    await new Promise((r) => setTimeout(r, 10));
    const required = { id: "cf-ctrl", name: "Contrôle", type: "text-single", required: true, disabled: false };
    env.http = async (req) => {
      const res = await mockHttp(req);
      if (!req.body?.includes("getProjectSettings") || !res.text) return res;
      const j = JSON.parse(res.text);
      j.data.getProjectSettings.testStepSettings.fields.push({ ...required, values: null });
      return { ...res, text: JSON.stringify(j) };
    };
    const { plan } = await pushTest(project, "LFRPS12-1420");
    const steps = readTest(project, "LFRPS12-1420").test.steps.map((_, i) => i + 1);
    expect(plan.warnings).toContain(`Contrôle is required in Xray and empty in step ${steps.join(", ")}.`);
    const x = readXray(project);
    expect(x.fields.map((f) => f.name)).toContain("Contrôle");
    expect(Date.parse(x.fetchedAt ?? "")).toBeGreaterThan(Date.parse(first));
  });
});

describe("pull", () => {
  it("downloads an image it does not have yet under a new name and rewrites the ref", async () => {
    rmSync(join(project, "tests/LFRPS12-1420/images"), { recursive: true });
    await pullToLocal(project, "LFRPS12-1420");
    const files = images("LFRPS12-1420");
    expect(files).toHaveLength(1);
    expect(files[0]).not.toBe("fig-40.png");
    const t = readTest(project, "LFRPS12-1420").test;
    expect(t.steps[0].images[0].file).toBe(`images/${files[0]}`);
    expect(t.steps[0].fields["Expected Result"]).toContain(`![](images/${files[0]} "width=320,height=160")`);
  });

  it("removes the images it wrote when another download of the same pull fails", async () => {
    rmSync(join(project, "tests/LFRPS12-1420/images"), { recursive: true });
    mockJiraTest("LFRPS12-1420")!.steps[1].attachments = [{ id: "missing", filename: "x.png" }];
    await expect(pullToLocal(project, "LFRPS12-1420")).rejects.toThrow(/Could not download x.png/);
    const dir = join(project, "tests/LFRPS12-1420/images");
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
    expect(existsSync(join(project, "tests/LFRPS12-1420/test.md"))).toBe(true);
  });

  it("is abandoned when the cancel comes while Jira answers", async () => {
    const c = new AbortController();
    env.http = async (req) => {
      if (req.url.endsWith("/graphql")) c.abort();
      return mockHttp(req);
    };
    await expect(pullToLocal(project, "LFRPS12-1401", { signal: c.signal })).rejects.toThrow(
      "Pull of LFRPS12-1401 cancelled",
    );
    expect(existsSync(join(project, "tests/LFRPS12-1401"))).toBe(false);
  });

  it("is abandoned when the cancel comes right before the file is written", async () => {
    let reads = 0;
    const signal = {
      get aborted() {
        reads++;
        return reads >= 4;
      },
    } as AbortSignal;
    await expect(pullToLocal(project, "LFRPS12-1405", { signal })).rejects.toThrow("cancelled");
    expect(reads).toBe(4);
    expect(existsSync(join(project, "tests/LFRPS12-1405"))).toBe(false);
  });

  it("on a re-pull after a push, a step re-created under a new id keeps its image by position", async () => {
    const prev = readTest(project, "LFRPS12-1420").test;
    const m = mockJiraTest("LFRPS12-1420")!;
    m.steps[0].id = "new-101";
    m.steps[0].attachments = [{ id: "9002", filename: "fig-40.png" }];
    m.steps[0].result = m.steps[0].result.replace("9001", "9002");
    const before = images("LFRPS12-1420");
    let downloads = 0;
    env.http = async (req) => {
      if (req.url.includes("/attachment/content/")) downloads++;
      return mockHttp(req);
    };
    await pullToLocal(project, "LFRPS12-1420", { prev });
    expect(downloads).toBe(0);
    expect(images("LFRPS12-1420")).toEqual(before);
    const t = readTest(project, "LFRPS12-1420").test;
    expect(t.steps[0].images).toEqual([{ file: "images/fig-40.png", remoteId: "9002" }]);
    expect(t.steps[0].sources).toEqual(prev.steps[0].sources);
  });
});

describe("checkRemote", () => {
  it("is unverified for a local test, and when Jira cannot be read", async () => {
    expect(await checkRemote(project, "local-3f9a12c0")).toBe("unverified");
    env.http = async () => ({ status: 500, headers: {}, text: "down" });
    expect(await checkRemote(project, "LFRPS12-1420")).toBe("unverified");
  });
});

describe("push", () => {
  it("insideTest accepts a file that does not exist yet", () => {
    const dir = join(project, "tests", "LFRPS12-1420");
    expect(insideTest(dir, "images/later.png")).toBe(join(dir, "images", "later.png"));
  });

  it("names every file outside the test folder", async () => {
    const { test } = readTest(project, "LFRPS12-1398");
    test.steps[0].images.push({ file: "../a.png" }, { file: "../b.png" });
    writeFileSync(join(project, "tests", "LFRPS12-1398", "test.md"), serializeTest(test));
    await expect(pushTest(project, "LFRPS12-1398")).rejects.toThrow(
      "Not pushed — step 1: ../a.png, step 1: ../b.png are outside the test folder",
    );
  });

  it("refuses a test pulled by an older version that did not keep Jira's embeds", async () => {
    const file = join(project, "tests/LFRPS12-1420/.remote.md");
    const old = readFileSync(file, "utf8")
      .replace(/!\[\]\([^)]*\)/g, "")
      .replace("### Attachments", "### Images");
    writeFileSync(file, old);
    await expect(pushTest(project, "LFRPS12-1420")).rejects.toThrow(
      "LFRPS12-1420 was pulled by an older version of the app",
    );
  });

  it("a create op fails when the local test is gone from tests/", async () => {
    const push = await pushTest(project, "local-3f9a12c0");
    rmSync(join(project, "tests/local-3f9a12c0"), { recursive: true });
    const states: string[] = [];
    const r = await executePlan(project, push, (i, s) => states.push(`${i}:${s}`));
    expect(r.ok).toBe(false);
    expect((r.error as Error).message).toBe(
      "local-3f9a12c0 is no longer in tests/ — another push probably created it in Jira.",
    );
    expect(states).toEqual(["0:failed"]);
  });

  it("a plan with nothing to run for a local test is a success without a pull", async () => {
    const { test } = readTest(project, "local-3f9a12c0");
    const push: Push = {
      plan: { ops: [], warnings: [], remoteChanged: false },
      local: test,
      id: "local-3f9a12c0",
      hash: "h",
    };
    expect(await executePlan(project, push, () => {})).toEqual({ ok: true, id: "local-3f9a12c0" });
  });

  it("reports the failed re-pull after a push that succeeded", async () => {
    const { test } = readTest(project, "LFRPS12-1420");
    const push: Push = {
      plan: { ops: [], warnings: [], remoteChanged: false },
      local: test,
      id: "LFRPS12-1420",
      hash: "h",
    };
    env.http = async () => ({ status: 500, headers: {}, text: "down" });
    const r = await executePlan(project, push, () => {});
    expect(r.ok).toBe(true);
    expect(r.id).toBe("LFRPS12-1420");
    expect(r.error).toBeInstanceOf(Error);
  });
});
