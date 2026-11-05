import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, test } from "vitest";
import { env } from "../../../../src/core/env.ts";
import { readColumns, setModes } from "../../../../src/core/lib/columns.ts";
import { resetAuth } from "../../../../src/core/lib/jira/http.ts";
import { readXray } from "../../../../src/core/lib/project.ts";
import { listLocalTests, localTestRef, readTest, writeTest } from "../../../../src/core/lib/store.ts";
import { freshXray, projectInfo } from "../../../../src/core/lib/sync/connect.ts";
import { checkRemote, extOf, pullToLocal } from "../../../../src/core/lib/sync/pull.ts";
import { executePlan, type Push, planView, pushTest, testFilePath } from "../../../../src/core/lib/sync/push.ts";
import { parseTest, serializeTest } from "../../../../src/core/lib/testfile.ts";
import { mockHttp, mockJira, mockJiraTest, resetMockJira } from "../../../../src/core/mock/jira.ts";

const FIXTURE = new URL("../../../fixtures/project/", import.meta.url);
const http = env.http;
let project = "";

const md = (id: string, file = "test.md") => readFileSync(join(project, "tests", id, file), "utf8");
const fixtureMd = (id: string, file: string) => readFileSync(new URL(`tests/${id}/${file}`, FIXTURE), "utf8");

afterAll(() => {
  env.http = http;
});

beforeEach(() => {
  project = join(mkdtempSync(join(tmpdir(), "testimus-sync-")), "LFRPS12");
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
  mockJira.maxAttachmentBytes = 10 * 1024 * 1024;
  env.http = mockHttp;
});

test("a pull of the fixture's remote test writes exactly its .remote.md, keeping the local Sources and file names", async () => {
  const reports: string[] = [];
  const stages: unknown[] = [];
  const report = (m: string, stage: unknown) => {
    reports.push(m);
    stages.push(stage);
  };
  expect(await pullToLocal(project, "LFRPS12-1420", { report })).toBe("LFRPS12-1420");
  expect(md("LFRPS12-1420")).toBe(fixtureMd("LFRPS12-1420", ".remote.md"));
  expect(md("LFRPS12-1420", ".remote.md")).toBe(md("LFRPS12-1420"));
  expect(readdirSync(join(project, "tests/LFRPS12-1420/images"))).toEqual(["fig-40.png"]);
  expect(reports).toEqual(["5 steps fetched", "image 1 of 1 downloaded", "writing test.md"]);
  expect(stages).toEqual([
    expect.objectContaining({ phase: "read", steps: 5, images: 1, summary: expect.any(String) }),
    { phase: "images", done: 1, total: 1 },
    { phase: "write" },
  ]);
  expect(localTestRef(project, "LFRPS12-1420")).toMatchObject({ sync: "synced", review: "draft" });
});

test("a pull of a remote-only test downloads nothing it does not need and reads the review from its label", async () => {
  await pullToLocal(project, "LFRPS12-1405");
  const { test: t } = readTest(project, "LFRPS12-1405");
  expect(t).toMatchObject({
    key: "LFRPS12-1405",
    folder: "/Traction/Sectionneurs",
    review: "draft",
    labels: ["regression"],
  });
  expect(t.steps.map((s) => s.fields.Exigence)).toEqual(["EXI_MOP_SPF_511_A_1670", "EXI_MOP_SPF_511_A_1680"]);
  expect(md("LFRPS12-1405")).toContain("### Exigence\n\nEXI_MOP_SPF_511_A_1670");

  mockJiraTest("LFRPS12-1398")!.labels = ["testimus-to-fix"];
  await pullToLocal(project, "LFRPS12-1398");
  const back = readTest(project, "LFRPS12-1398").test;
  expect(back.review).toBe("to-fix");
  expect(back.labels).toEqual([]);
  expect(md("LFRPS12-1398")).not.toContain("testimus-to-fix");
  expect(back.reviewedBy).toBeUndefined();
  expect(back.steps[0].sources).toHaveLength(1);
});

test("checkRemote compares with .remote.md the way remoteChanged does, and leaves the marker the list reads", async () => {
  expect(await checkRemote(project, "LFRPS12-1420")).toBe("unchanged");
  expect(localTestRef(project, "LFRPS12-1420")?.sync).toBe("modified");

  mockJiraTest("LFRPS12-1420")!.status = "Blocked";
  expect(await checkRemote(project, "LFRPS12-1420")).toBe("unchanged");

  mockJiraTest("LFRPS12-1420")!.summary = "Renamed in Jira";
  expect(await checkRemote(project, "LFRPS12-1420")).toBe("remote-changed");
  expect(localTestRef(project, "LFRPS12-1420")?.sync).toBe("remote-changed");
  expect((await pushTest(project, "LFRPS12-1420")).plan.remoteChanged).toBe(true);

  expect(await checkRemote(project, "local-3f9a12c0")).toBe("unverified");
  env.http = async () => ({ status: 501, headers: {}, text: "no network" });
  expect(await checkRemote(project, "LFRPS12-1398")).toBe("unverified");
});

test("the preconditions and covers Jira hands back in its own order are not a remote change", async () => {
  const remote = parseTest(md("LFRPS12-1420", ".remote.md")).test;
  mockJiraTest("LFRPS12-1420")!.preconditions = ["30078", "30077"];
  writeFileSync(
    join(project, "tests/LFRPS12-1420/.remote.md"),
    serializeTest({ ...remote, preconditions: ["LFRPS12-78", "LFRPS12-77"] }),
  );
  expect(await checkRemote(project, "LFRPS12-1420")).toBe("unchanged");
});

test("the fixture's modified test plans its review label and the one step that changed, then pushes", async () => {
  const push = await pushTest(project, "LFRPS12-1420");
  expect(planView(push)).toEqual({
    testId: "LFRPS12-1420",
    key: "LFRPS12-1420",
    ops: [
      { label: "Update labels (review label testimus-draft)", kind: "label" },
      { label: "Update step 2", kind: "update" },
    ],
    warnings: ["This test is not validated (review: draft) — it goes to Jira labelled testimus-draft."],
    remoteChanged: false,
    review: "draft",
    planHash: push.hash,
  });
  expect(push.hash).toMatch(/^[0-9a-f]{16}$/);

  const seen: Array<[number, string]> = [];
  const r = await executePlan(project, push, (i, s) => seen.push([i, s]));
  expect(r).toEqual({ ok: true, id: "LFRPS12-1420" });
  expect(seen).toEqual([
    [0, "running"],
    [0, "done"],
    [1, "running"],
    [1, "done"],
  ]);
  const jira = mockJiraTest("LFRPS12-1420")!;
  expect(jira.labels).toEqual(["testimus-draft"]);
  expect(jira.steps[1].result).toContain("Autoriser l'ouverture");
  expect(md("LFRPS12-1420")).toBe(fixtureMd("LFRPS12-1420", "test.md"));
  expect(localTestRef(project, "LFRPS12-1420")?.sync).toBe("synced");
});

test("round trip: pull a remote test, edit fields and review, plan, push, and Jira holds every field", async () => {
  await pullToLocal(project, "LFRPS12-1405");
  const { test: t } = readTest(project, "LFRPS12-1405");
  t.review = "validated";
  t.steps[0].fields.Exigence = "EXI_MOP_SPF_511_A_1670, EXI_MOP_SPF_511_A_1690";
  t.steps[0].sources = [{ docId: "SOSIE_211_D401-1_3", anchor: "§5.6.6", quote: "ne propose que Propriétés" }];
  t.steps.push({
    fields: { Action: "Fermer la fenêtre.", "Expected Result": "La fenêtre se ferme.", Exigence: "EXI_X" },
    sources: [],
    images: [],
  });
  writeTest(project, "LFRPS12-1405", t);
  expect(localTestRef(project, "LFRPS12-1405")?.sync).toBe("modified");

  const push = await pushTest(project, "LFRPS12-1405");
  expect(planView(push).ops.map((o) => o.label)).toEqual([
    "Update labels (review label testimus-validated)",
    "Update step 1",
    "Add step 3",
  ]);
  expect(push.plan.warnings).toEqual([]);
  expect(await executePlan(project, push, () => {})).toEqual({ ok: true, id: "LFRPS12-1405" });

  const jira = mockJiraTest("LFRPS12-1405")!;
  expect(jira.labels).toEqual(["regression", "testimus-validated"]);
  expect(jira.steps.map((s) => s.custom["cf-exigence"])).toEqual([
    "EXI_MOP_SPF_511_A_1670, EXI_MOP_SPF_511_A_1690",
    "EXI_MOP_SPF_511_A_1680",
    "EXI_X",
  ]);
  expect(JSON.stringify(jira)).not.toContain("ne propose que");

  const after = readTest(project, "LFRPS12-1405").test;
  expect(after.review).toBe("validated");
  expect(after.steps[0].sources).toHaveLength(1);
  expect(after.steps[2].id).toBeTruthy();
  expect(localTestRef(project, "LFRPS12-1405")?.sync).toBe("synced");
  expect((await pushTest(project, "LFRPS12-1405")).plan.ops).toEqual([]);
});

test("a local test is created, renamed to its key, re-pulled with its Sources and review note kept", async () => {
  const push = await pushTest(project, "local-3f9a12c0");
  expect(planView(push).ops).toEqual([{ label: "Create test in Jira (local-3f9a12c0)", kind: "create" }]);
  expect(push.plan.warnings).toEqual([
    "This test is not validated (review: to-fix) — it goes to Jira labelled testimus-to-fix.",
  ]);
  const r = await executePlan(project, push, () => {});
  expect(r.ok).toBe(true);
  expect(r.id).toMatch(/^LFRPS12-\d+$/);
  expect(existsSync(join(project, "tests/local-3f9a12c0"))).toBe(false);

  const jira = mockJiraTest(r.id)!;
  expect(jira).toMatchObject({ folder: "/Traction/Sectionneurs", labels: ["testimus-to-fix"] });
  expect(jira.steps.map((s) => s.custom["cf-exigence"])).toEqual(["EXI_MOP_SPF_511_A_1650", "EXI_MOP_SPF_511_A_1670"]);

  const t = readTest(project, r.id).test;
  expect(t).toMatchObject({
    key: r.id,
    review: "to-fix",
    reviewNote: "Le step 2 doit vérifier que seul Propriétés est proposé.",
  });
  expect(t.steps.map((s) => s.sources.length)).toEqual([1, 1]);
  expect(localTestRef(project, r.id)?.sync).toBe("synced");
});

test("a push stops at the first failing op, keeps the new key, and resumes from that op", async () => {
  const { test: t } = readTest(project, "local-3f9a12c0");
  const png = readFileSync(new URL("tests/LFRPS12-1420/images/fig-40.png", FIXTURE));
  mkdirSync(join(project, "tests/local-3f9a12c0/images"), { recursive: true });
  writeFileSync(join(project, "tests/local-3f9a12c0/images/img-0000aaaa.png"), png);
  t.covers = ["LFRPS12-880"];
  writeTest(project, "local-3f9a12c0", t);

  const first = await pushTest(project, "local-3f9a12c0");
  const r0 = await executePlan(project, first, () => {});
  const key = r0.id;

  const { test: pulled } = readTest(project, key);
  pulled.steps[1].images.push({ file: "images/img-0000aaaa.png" });
  pulled.steps[1].fields["Expected Result"] += "\n\n![](images/img-0000aaaa.png)";
  pulled.summary = "Renamed";
  writeTest(project, key, pulled);

  mockJira.maxAttachmentBytes = 10;
  const push = await pushTest(project, key);
  expect(planView(push).ops.map((o) => o.label)).toEqual([
    "Update summary",
    "Upload 1 image to step 2",
    "Embed 1 image in step 2",
  ]);
  const r = await executePlan(project, push, () => {});
  expect(r).toMatchObject({ ok: false, failedAt: 1, id: key });
  expect(String((r.error as Error).message)).toBe(
    "Xray: Attachment img-0000aaaa.png is 667 bytes — over the 10 bytes Jira accepts.",
  );
  expect(mockJiraTest(key)!.summary).toBe("Renamed");

  mockJira.maxAttachmentBytes = 10 * 1024 * 1024;
  const resumed = await executePlan(project, push, () => {}, 1);
  expect(resumed).toEqual({ ok: true, id: key });
  const jira = mockJiraTest(key)!;
  expect(jira.steps[1].attachments).toHaveLength(1);
  expect(jira.steps[1].result).toContain(`!xray-attachment://${jira.steps[1].attachments[0].id}!`);
  expect(readTest(project, key).test.steps[1].images).toEqual([
    { file: "images/img-0000aaaa.png", remoteId: jira.steps[1].attachments[0].id },
  ]);
});

test("a picture's figure stays local: the push re-pull keeps it and the test reads as synced", async () => {
  const { test: t } = readTest(project, "local-3f9a12c0");
  const png = readFileSync(new URL("tests/LFRPS12-1420/images/fig-40.png", FIXTURE));
  mkdirSync(join(project, "tests/local-3f9a12c0/images"), { recursive: true });
  writeFileSync(join(project, "tests/local-3f9a12c0/images/img-0000bbbb.png"), png);
  t.steps[1].images.push({ file: "images/img-0000bbbb.png", figure: "SOSIE_211_D401-1_3#fig:40" });
  t.steps[1].fields["Expected Result"] += "\n\n![](images/img-0000bbbb.png)";
  writeTest(project, "local-3f9a12c0", t);

  const r = await executePlan(project, await pushTest(project, "local-3f9a12c0"), () => {});
  expect(r.ok).toBe(true);
  const jira = mockJiraTest(r.id)!;
  expect(readTest(project, r.id).test.steps[1].images).toEqual([
    {
      file: "images/img-0000bbbb.png",
      remoteId: jira.steps[1].attachments[0].id,
      figure: "SOSIE_211_D401-1_3#fig:40",
    },
  ]);
  expect(localTestRef(project, r.id)?.sync).toBe("synced");
});

test("a created test keeps its key on disk when a later op fails, so the next push cannot create it twice", async () => {
  const { test: t } = readTest(project, "local-3f9a12c0");
  t.covers = ["LFRPS12-880"];
  writeTest(project, "local-3f9a12c0", t);
  const push = await pushTest(project, "local-3f9a12c0");
  expect(push.plan.ops.map((o) => o.label)).toEqual([
    "Create test in Jira (local-3f9a12c0)",
    "Link Test to LFRPS12-880",
  ]);
  const real = mockHttp;
  env.http = async (req) => (req.url.endsWith("/issueLink") ? { status: 500, headers: {}, text: "boom" } : real(req));
  const r = await executePlan(project, push, () => {});
  expect(r).toMatchObject({ ok: false, failedAt: 1, id: "local-3f9a12c0" });
  const key = readTest(project, "local-3f9a12c0").test.key!;
  expect(key).toMatch(/^LFRPS12-/);
  env.http = real;
  const again = await pushTest(project, "local-3f9a12c0");
  expect(again.plan.ops.some((o) => o.kind === "create")).toBe(false);
});

test("a cancelled pull abandons the download and leaves nothing on disk", async () => {
  const c = new AbortController();
  env.http = async (req) => {
    if (req.url.includes("/attachment/content/")) c.abort();
    return mockHttp(req);
  };
  const { test: t } = readTest(project, "LFRPS12-1420");
  t.steps[0].images = [];
  writeTest(project, "LFRPS12-1420", t);
  const before = md("LFRPS12-1420");
  await expect(pullToLocal(project, "LFRPS12-1420", { signal: c.signal })).rejects.toThrow("cancelled");
  expect(md("LFRPS12-1420")).toBe(before);
  expect(readdirSync(join(project, "tests/LFRPS12-1420/images"))).toEqual(["fig-40.png"]);

  await expect(pullToLocal(project, "LFRPS12-1401", { signal: AbortSignal.abort() })).rejects.toThrow("cancelled");
  expect(existsSync(join(project, "tests/LFRPS12-1401"))).toBe(false);
});

test("a pull whose download fails leaves nothing on disk", async () => {
  env.http = async (req) =>
    req.url.includes("/attachment/content/") ? { status: 500, headers: {}, text: "nope" } : mockHttp(req);
  const { rmSync } = await import("node:fs");
  rmSync(join(project, "tests/LFRPS12-1420"), { recursive: true });
  await expect(pullToLocal(project, "LFRPS12-1420")).rejects.toThrow(/Could not download fig-40.png/);
  expect(existsSync(join(project, "tests/LFRPS12-1420"))).toBe(false);
  expect(listLocalTests(project).some((x) => x.id === "LFRPS12-1420")).toBe(false);
});

test("a review label moved in Jira alone is a change in Jira, though test.md keeps no review label", async () => {
  await pullToLocal(project, "LFRPS12-1405");
  expect(await checkRemote(project, "LFRPS12-1405")).toBe("unchanged");
  const jira = mockJiraTest("LFRPS12-1405")!;
  jira.labels = [...jira.labels.filter((l) => !l.startsWith("testimus-")), "testimus-validated"];
  expect(await checkRemote(project, "LFRPS12-1405")).toBe("remote-changed");
});

test("trailing blank lines and CRLF in Jira's step text are not a change: a fresh pull plans no step update", async () => {
  const jira = mockJiraTest("LFRPS12-1405")!;
  jira.labels = ["regression", "testimus-draft"];
  jira.steps[0].action = "Clic droit\r\nsur un sectionneur avec TK.\r\n";
  jira.steps[0].result = `${jira.steps[0].result}\n\n`;
  jira.steps[1].data = "Fenêtre ouverte.\r\n\r\n";
  jira.steps[1].custom["cf-exigence"] = "EXI_MOP_SPF_511_A_1680\r\n\n";

  await pullToLocal(project, "LFRPS12-1405");
  const push = await pushTest(project, "LFRPS12-1405");
  expect(planView(push).ops).toEqual([]);
  expect(await checkRemote(project, "LFRPS12-1405")).toBe("unchanged");
  expect(localTestRef(project, "LFRPS12-1405")?.sync).toBe("synced");
});

test("an attachment filename without an extension falls back to png", () => {
  expect(extOf("shot-1.PNG")).toBe("png");
  expect(extOf("screenshot")).toBe("png");
  expect(extOf("a.b.jpeg")).toBe("jpeg");
});

test("pulling five tests at once keeps at most three pulls in flight", async () => {
  const keys = ["LFRPS12-1420", "LFRPS12-1398", "LFRPS12-1401", "LFRPS12-1405", "LFRPS12-1410"];
  const started = new Set<string>();
  let hold = true;
  const held: (() => void)[] = [];
  env.http = async (req) => {
    const seen = `${req.url} ${req.body ?? ""}`;
    for (const k of keys) if (new RegExp(`${k}(?![0-9])`).test(seen)) started.add(k);
    if (hold) await new Promise<void>((r) => held.push(r));
    return mockHttp(req);
  };
  const all = Promise.all(keys.map((k) => pullToLocal(project, k)));
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  expect([...started]).toEqual(keys.slice(0, 3));
  hold = false;
  for (const r of held) r();
  expect(await all).toEqual(keys);
  expect(started.size).toBe(5);
});

const images = (id: string) => readdirSync(join(project, "tests", id, "images"));

describe("freshXray and projectInfo", () => {
  it("reads the step fields once the project info is cached, keeps the team's columns, and falls back offline", async () => {
    setModes(project, { Exigence: "collapsed" });
    const before = readColumns(project);
    const { fields, fetchedAt } = await freshXray(project);
    expect(readColumns(project)).toEqual(before);
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

  it("fetches the project info again when its cache is corrupt, or names another project, and rewrites it", async () => {
    const cache = join(project, ".testimus", "jira-project.json");
    let projectCalls = 0;
    env.http = async (req) => {
      if (req.url.includes("/rest/api/3/project/")) projectCalls++;
      return mockHttp(req);
    };
    mkdirSync(join(project, ".testimus"), { recursive: true });
    for (const bad of ["{ not json", JSON.stringify({ key: "OTHER", id: "1" }), JSON.stringify({ key: "LFRPS12" })]) {
      writeFileSync(cache, bad);
      const info = await projectInfo(project);
      expect(info.key).toBe("LFRPS12");
      expect(info.id).toBeTruthy();
      expect(JSON.parse(readFileSync(cache, "utf8"))).toEqual(info);
    }
    expect(projectCalls).toBe(3);
    await projectInfo(project);
    expect(projectCalls).toBe(3);
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
  it("testFilePath accepts a file that does not exist yet", () => {
    const dir = join(project, "tests", "LFRPS12-1420");
    expect(testFilePath(dir, "images/later.png")).toBe(join(dir, "images", "later.png"));
  });

  it("names every file outside the test folder", async () => {
    const { test } = readTest(project, "LFRPS12-1398");
    test.steps[0].images.push({ file: "../a.png" }, { file: "../b.png" });
    writeFileSync(join(project, "tests", "LFRPS12-1398", "test.md"), serializeTest(test));
    await expect(pushTest(project, "LFRPS12-1398")).rejects.toThrow(
      "Not pushed — step 1: ../a.png, step 1: ../b.png are outside the test folder",
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
