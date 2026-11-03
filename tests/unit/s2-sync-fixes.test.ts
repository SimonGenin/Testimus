import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { quietCtx } from "../../src/core/command.ts";
import { commands } from "../../src/core/commands/xray.ts";
import { env, type HttpReq } from "../../src/core/env.ts";
import { resetAuth } from "../../src/core/lib/jira/http.ts";
import { labelPrefixOf, reviewLabels, reviewOfLabels } from "../../src/core/lib/jira/labels.ts";
import { readProject, writeProject } from "../../src/core/lib/project.ts";
import { listLocalTests, readTest, writeTest } from "../../src/core/lib/store.ts";
import { executePlan, pushTest, testFilePath } from "../../src/core/lib/sync/push.ts";
import { serializeTest } from "../../src/core/lib/testfile.ts";
import { mockHttp, mockJiraTest, resetMockJira } from "../../src/core/mock/jira.ts";

const FIXTURE = new URL("../fixtures/project/", import.meta.url);
const http = env.http;
let project = "";
let sent: HttpReq[] = [];

const run = async (name: string, raw: unknown = {}, signal?: AbortSignal): Promise<any> => {
  const c = commands.find((x) => x.name === name);
  if (!c) throw new Error(`no command ${name}`);
  return c.run(quietCtx(project, signal), c.input.parse(raw) as never);
};

const writes = () => sent.filter((r) => r.method === "PUT" || (r.body ?? "").includes("mutation"));

afterAll(() => {
  env.http = http;
});

beforeEach(() => {
  project = join(mkdtempSync(join(tmpdir(), "testimus-s2-")), "LFRPS12");
  cpSync(FIXTURE, project, { recursive: true });
  const dir = join(env.homeDir(), ".atlassian");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "credentials.json"),
    JSON.stringify({ baseUrl: "https://mock.atlassian.net/wiki", email: "tester@example.com", token: "t" }),
  );
  writeFileSync(join(dir, "xray_credentials.json"), JSON.stringify({ clientId: "id", clientSecret: "secret" }));
  resetMockJira();
  resetAuth();
  sent = [];
  env.http = (req) => {
    sent.push(req);
    return mockHttp(req);
  };
});

describe("M6 — a cancel stops the push between operations", () => {
  it("lets the op in flight finish, never starts the next, and says something ran after the cancel", async () => {
    const { planHash } = await run("xray.plan", { id: "LFRPS12-1420" });
    const ctrl = new AbortController();
    env.http = (req) => {
      sent.push(req);
      if (req.method === "PUT") ctrl.abort();
      return mockHttp(req);
    };
    sent = [];
    const out = await run("xray.push", { id: "LFRPS12-1420", planHash }, ctrl.signal);
    expect(out).toMatchObject({ ok: false, failedAt: 1, cancelled: false });
    expect(out.error).toBe("Push cancelled — operation 2 was not started.");
    expect(out.ops.map((o: any) => o.status)).toEqual(["done", "not-started"]);
    expect(writes().map((r) => r.method)).toEqual(["PUT"]);
    expect(mockJiraTest("LFRPS12-1420")!.labels).toEqual(["testimus-checked"]);

    env.http = mockHttp;
    const resumed = await run("xray.push", { id: "LFRPS12-1420", planHash, from: 1 });
    expect(resumed).toMatchObject({ ok: true, cancelled: false });
    expect(resumed.ops.map((o: any) => o.status)).toEqual(["done", "done"]);
  });

  it("is a clean cancel when it comes before the first op: nothing is written", async () => {
    const { planHash } = await run("xray.plan", { id: "LFRPS12-1420" });
    const ctrl = new AbortController();
    ctrl.abort();
    sent = [];
    const out = await run("xray.push", { id: "LFRPS12-1420", planHash }, ctrl.signal);
    expect(out).toMatchObject({ ok: false, failedAt: 0, cancelled: true });
    expect(out.error).toBe("Push cancelled — operation 1 and the 1 after it were not started.");
    expect(out.ops.map((o: any) => o.status)).toEqual(["not-started", "not-started"]);
    expect(writes()).toEqual([]);
  });
});

describe("M7 — one push of a test at a time", () => {
  it("refuses a second concurrent push of the same test, so Jira gets one test", async () => {
    const { planHash } = await run("xray.plan", { id: "local-3f9a12c0" });
    const [a, b] = await Promise.allSettled([
      run("xray.push", { id: "local-3f9a12c0", planHash }),
      run("xray.push", { id: "local-3f9a12c0", planHash }),
    ]);
    expect(a.status).toBe("fulfilled");
    expect(b).toMatchObject({
      status: "rejected",
      reason: { message: "A push of local-3f9a12c0 is already running." },
    });
    expect(writes().filter((r) => (r.body ?? "").includes("createTest"))).toHaveLength(1);
    const created = (a as PromiseFulfilledResult<any>).value.id;
    expect(listLocalTests(project).map((r) => r.id)).toContain(created);
    const again = await run("xray.push", { id: created, dryRun: true });
    expect(again.ok).toBe(true);
  });

  it("re-reads the local test before the create op and refuses when another push already created it", async () => {
    const stale = await pushTest(project, "local-3f9a12c0");
    const { test } = readTest(project, "local-3f9a12c0");
    writeTest(project, "local-3f9a12c0", { ...test, key: "LFRPS12-1600" });
    const out = await executePlan(project, stale, () => {});
    expect(out.ok).toBe(false);
    expect(out.failedAt).toBe(0);
    expect((out.error as Error).message).toBe(
      "local-3f9a12c0 was already created in Jira as LFRPS12-1600 — this plan is out of date.",
    );
    expect(writes().filter((r) => (r.body ?? "").includes("createTest"))).toEqual([]);
  });
});

describe("M8 — a push uploads only files of the test folder", () => {
  it("testFilePath accepts the test's own files and refuses anything that leaves the folder", () => {
    const dir = join(project, "tests", "LFRPS12-1420");
    expect(testFilePath(dir, "images/fig-40.png")).toBe(join(dir, "images", "fig-40.png"));
    for (const bad of ["", "../LFRPS12-1398/test.md", "images/../../x.png", "/etc/passwd", "C:/Windows/win.ini"])
      expect(testFilePath(dir, bad), bad).toBeNull();
    expect(testFilePath(dir, join(dir, "images", "fig-40.png"))).toBeNull();
  });

  it("refuses the plan when a step attaches a file outside tests/<id>/, and sends nothing", async () => {
    writeFileSync(join(project, "secret.json"), '{"token":"x"}');
    const { test } = readTest(project, "LFRPS12-1398");
    test.steps[0].images.push({ file: "../../secret.json" });
    writeFileSync(join(project, "tests", "LFRPS12-1398", "test.md"), serializeTest(test));
    expect(readTest(project, "LFRPS12-1398").test.steps[0].images.map((im) => im.file)).toContain("../../secret.json");
    sent = [];
    await expect(run("xray.plan", { id: "LFRPS12-1398" })).rejects.toThrow(
      "Not pushed — step 1: ../../secret.json is outside the test folder tests/LFRPS12-1398/; a push only uploads the test's own images.",
    );
    await expect(run("xray.push", { id: "LFRPS12-1398", planHash: "x" })).rejects.toThrow("outside the test folder");
    expect(sent).toEqual([]);
  });
});

describe("M14 — the push runs the plan the user saw", () => {
  it("returns a planHash with the plan and the dry run, and refuses a push without one", async () => {
    const plan = await run("xray.plan", { id: "LFRPS12-1420" });
    expect(plan.planHash).toMatch(/^[0-9a-f]{16}$/);
    expect((await run("xray.push", { id: "LFRPS12-1420", dryRun: true })).plan.planHash).toBe(plan.planHash);
    await expect(run("xray.push", { id: "LFRPS12-1420" })).rejects.toThrow(
      "A push runs only the plan you looked at — no planHash given.",
    );
    expect(writes()).toEqual([]);
  });

  it("refuses when the test changed since the plan", async () => {
    const { planHash } = await run("xray.plan", { id: "LFRPS12-1420" });
    const { test } = readTest(project, "LFRPS12-1420");
    writeTest(project, "LFRPS12-1420", { ...test, summary: `${test.summary} (edited)` });
    await expect(run("xray.push", { id: "LFRPS12-1420", planHash })).rejects.toThrow(
      "The test or Jira changed since you saw the plan — nothing was pushed.",
    );
    expect(writes()).toEqual([]);
  });

  it("refuses when Jira changed the ops since the plan", async () => {
    const { planHash, ops } = await run("xray.plan", { id: "LFRPS12-1420" });
    mockJiraTest("LFRPS12-1420")!.labels = ["testimus-checked"];
    const now = await run("xray.plan", { id: "LFRPS12-1420" });
    expect(now.ops.length).toBeLessThan(ops.length);
    await expect(run("xray.push", { id: "LFRPS12-1420", planHash })).rejects.toThrow("changed since you saw the plan");
    expect(writes()).toEqual([]);
    expect((await run("xray.push", { id: "LFRPS12-1420", planHash: now.planHash, overwriteRemote: true })).ok).toBe(
      true,
    );
  });
});

describe("minor 4 — a test changed in Jira is pushed only on the explicit choice", () => {
  it("refuses without overwriteRemote and pushes with it", async () => {
    mockJiraTest("LFRPS12-1398")!.summary = "Changed by someone else";
    const plan = await run("xray.plan", { id: "LFRPS12-1398" });
    expect(plan.remoteChanged).toBe(true);
    await expect(run("xray.push", { id: "LFRPS12-1398", planHash: plan.planHash })).rejects.toThrow(
      "LFRPS12-1398 was changed in Jira since your last sync — pushing would replace that change.",
    );
    expect(writes()).toEqual([]);
    const out = await run("xray.push", { id: "LFRPS12-1398", planHash: plan.planHash, overwriteRemote: true });
    expect(out.ok).toBe(true);
    expect(mockJiraTest("LFRPS12-1398")!.summary).not.toBe("Changed by someone else");
  });
});

describe("minor 10 — an unusable label prefix falls back to testimus-", () => {
  it("never treats the team's own labels as review labels", () => {
    expect(labelPrefixOf("")).toBe("testimus-");
    expect(labelPrefixOf("qa team-")).toBe("testimus-");
    expect(labelPrefixOf("qa-")).toBe("qa-");
    expect(reviewLabels(["draft", "validated", "x"], "checked", "")).toEqual([
      "draft",
      "validated",
      "x",
      "testimus-checked",
    ]);
    expect(reviewOfLabels(["validated"], "")).toBeUndefined();
    expect(reviewOfLabels(["testimus-validated"], " ")).toBe("validated");
  });

  it("warns in the plan and labels with the default", async () => {
    writeProject(project, { ...readProject(project), labelPrefix: "" });
    const plan = await run("xray.plan", { id: "LFRPS12-1420" });
    expect(plan.warnings[0]).toBe(
      'The label prefix "" in project.json is empty or has a space — the review label uses testimus- instead (set a prefix without spaces in the project settings).',
    );
    expect(plan.ops[0].label).toBe("Update labels (review label testimus-checked)");
  });
});
