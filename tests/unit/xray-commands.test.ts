import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { quietCtx } from "../../src/core/command.ts";
import { commands } from "../../src/core/commands/xray.ts";
import { env } from "../../src/core/env.ts";
import { resetAuth } from "../../src/core/lib/jira.ts";
import { readProject, readXray } from "../../src/core/lib/project.ts";
import { listLocalTests, localTestRef, readTest, writeTest } from "../../src/core/lib/store.ts";
import { mockHttp, mockJira, mockJiraTest, resetMockJira } from "../../src/core/mock/jira.ts";

const FIXTURE = new URL("../fixtures/project/", import.meta.url);
const CSV = new URL("../fixtures/csv/sectionneur-traction-l92.csv", import.meta.url);
const http = env.http;
let project = "";

const run = async (name: string, raw: unknown = {}): Promise<any> => {
  const c = commands.find((x) => x.name === name);
  if (!c) throw new Error(`no command ${name}`);
  return c.run(quietCtx(project), c.input.parse(raw) as never);
};

afterAll(() => {
  env.http = http;
});

beforeEach(() => {
  project = join(mkdtempSync(join(tmpdir(), "testimus-xray-")), "LFRPS12");
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

describe("xray commands", () => {
  it("every input field is described", () => {
    for (const c of commands) {
      const shape = (c.input as any).shape as Record<string, { description?: string }>;
      for (const [k, v] of Object.entries(shape)) expect(v.description, `${c.name} ${k}`).toBeTruthy();
    }
  });

  it("xray.fields fetches the step schema and keeps the local prefs", async () => {
    const before = readXray(project).prefs;
    const out = await run("xray.fields");
    expect(out.fields).toEqual([
      { id: "action", name: "Action", type: "text", builtin: true },
      { id: "data", name: "Data", type: "text", builtin: true },
      { id: "result", name: "Expected Result", type: "text", builtin: true },
      { id: "cf-exigence", name: "Exigence", type: "text-single", builtin: false },
    ]);
    expect(readXray(project)).toEqual({ ...out, prefs: before });
    expect(existsSync(join(project, ".testimus/jira-project.json"))).toBe(true);
  });

  it("xray.prefs sets order, folded and hidden fields, and refuses a name that is not a field", async () => {
    const out = await run("xray.prefs", { order: ["Exigence", "Action"], hidden: ["Data"] });
    expect(out.prefs).toEqual({
      order: ["Exigence", "Action", "Data", "Expected Result"],
      collapsed: [],
      hidden: ["Data"],
      filled: ["Data"],
    });
    expect(readXray(project).prefs.hidden).toEqual(["Data"]);
    expect((await run("xray.prefs", { open: ["Exigence"] })).prefs.open).toEqual(["Exigence"]);
    expect((await run("xray.prefs", { hidden: [] })).prefs.open).toEqual(["Exigence"]);
    expect((await run("xray.prefs", { open: [] })).prefs.open).toBeUndefined();
    await expect(run("xray.prefs", { collapsed: ["Priorité"] })).rejects.toThrow(
      "Not a step field of this project: Priorité.",
    );
  });

  it("xray.prefs accepts a tracked id column that is in neither Xray nor xray.json", async () => {
    const p = readProject(project);
    writeFileSync(
      join(project, "project.json"),
      JSON.stringify({ ...p, traces: [{ id: "alarm", label: "Alarm", patterns: ["ALM_\\d+"], field: "Alarme" }] }),
    );
    const out = await run("xray.prefs", { filled: ["Data", "Alarme"] });
    expect(out.prefs.filled).toEqual(["Data", "Alarme"]);
    expect(readXray(project).prefs.filled).toEqual(["Data", "Alarme"]);
  });

  it("xray.folders and xray.search read the remote tree and tests", async () => {
    const root = await run("xray.folders");
    expect(root.folders.map((f: any) => [f.path, f.totalCount])).toEqual([
      ["/Signalisation", 2],
      ["/Traction", 4],
    ]);
    const inFolder = await run("xray.search", { folder: "/Traction", descendants: true });
    expect(inFolder.tests.map((t: any) => t.key)).toEqual([
      "LFRPS12-1398",
      "LFRPS12-1401",
      "LFRPS12-1405",
      "LFRPS12-1420",
    ]);
    expect((await run("xray.search", { text: "1420" })).tests.map((t: any) => t.key)).toEqual(["LFRPS12-1420"]);
    expect((await run("xray.search", { text: "signal rouge" })).tests.map((t: any) => t.key)).toEqual(["LFRPS12-1410"]);
  });

  it("xray.pull pulls a folder and skips the local copy that has unpushed changes", async () => {
    const out = await run("xray.pull", { folder: "/Traction" });
    expect(out).toEqual({
      pulled: ["LFRPS12-1398", "LFRPS12-1401", "LFRPS12-1405"],
      skipped: [{ key: "LFRPS12-1420", reason: "local copy has unpushed changes (pull with overwrite to replace it)" }],
      failed: [],
    });
    expect(localTestRef(project, "LFRPS12-1401")?.sync).toBe("synced");
    const again = await run("xray.pull", { key: "lfrps12-1420", overwrite: true });
    expect(again.pulled).toEqual(["LFRPS12-1420"]);
    expect(readTest(project, "LFRPS12-1420").test.review).toBe("draft");
    expect((await run("xray.pull", { key: "LFRPS12-9999" })).failed[0].error).toBe(
      "Jira 404 — issue LFRPS12-9999 not found",
    );
  });

  it("xray.status re-checks Jira and reports a remote change", async () => {
    mockJiraTest("LFRPS12-1398")!.summary = "Changed by someone else";
    const out = await run("xray.status");
    expect(out.tests).toEqual([
      { id: "LFRPS12-1398", key: "LFRPS12-1398", sync: "remote-changed", remote: "remote-changed" },
      { id: "LFRPS12-1420", key: "LFRPS12-1420", sync: "modified", remote: "unchanged" },
      { id: "local-3f9a12c0", sync: "local", remote: "unverified" },
    ]);
    expect((await run("xray.status", { id: "LFRPS12-1420" })).tests).toHaveLength(1);
  });

  it("xray.plan and a dry run write nothing", async () => {
    const plan = await run("xray.plan", { id: "LFRPS12-1420" });
    expect(plan.ops.map((o: any) => o.label)).toEqual([
      "Update labels (review label testimus-checked)",
      "Update step 2",
    ]);
    const dry = await run("xray.push", { id: "LFRPS12-1420", dryRun: true });
    expect(dry.ops.map((o: any) => o.status)).toEqual(["not-started", "not-started"]);
    expect(mockJiraTest("LFRPS12-1420")!.labels).toEqual(["testimus-draft"]);
  });

  it("xray.push reports per-op results, stops at the failing op and resumes from it", async () => {
    const { test: t } = readTest(project, "LFRPS12-1398");
    mkdirSync(join(project, "tests/LFRPS12-1398/images"), { recursive: true });
    writeFileSync(
      join(project, "tests/LFRPS12-1398/images/img-0000bbbb.png"),
      readFileSync(new URL("tests/LFRPS12-1420/images/fig-40.png", FIXTURE)),
    );
    t.steps[0].images.push({ file: "images/img-0000bbbb.png" });
    t.steps[0].fields["Expected Result"] += "\n\n![](images/img-0000bbbb.png)";
    t.summary = "Disjoncteur — ouverture à distance depuis le PCC";
    writeTest(project, "LFRPS12-1398", t);

    mockJira.maxAttachmentBytes = 10;
    const { planHash } = await run("xray.plan", { id: "LFRPS12-1398" });
    const stopped = await run("xray.push", { id: "LFRPS12-1398", planHash });
    expect(stopped).toMatchObject({ ok: false, id: "LFRPS12-1398", failedAt: 1 });
    expect(stopped.ops.map((o: any) => o.status)).toEqual(["done", "failed", "not-started"]);
    expect(stopped.ops[1].error).toMatch(/^Xray: Attachment img-0000bbbb\.png/);

    mockJira.maxAttachmentBytes = 10 * 1024 * 1024;
    expect(stopped.plan.planHash).toBe(planHash);
    const resumed = await run("xray.push", { id: "LFRPS12-1398", from: 1, planHash });
    expect(resumed).toMatchObject({ ok: true, id: "LFRPS12-1398" });
    expect(resumed.ops.map((o: any) => o.status)).toEqual(["done", "done", "done"]);
    expect(localTestRef(project, "LFRPS12-1398")?.sync).toBe("synced");
  });

  it("xray.push creates a local test and answers with its new key", async () => {
    const { planHash } = await run("xray.plan", { id: "local-3f9a12c0" });
    const out = await run("xray.push", { id: "local-3f9a12c0", planHash });
    expect(out.ok).toBe(true);
    expect(out.id).toMatch(/^LFRPS12-\d+$/);
    expect(out.plan.warnings[0]).toContain("not validated (review: to-fix)");
    expect(listLocalTests(project).map((r) => r.id)).toContain(out.id);
  });
});

describe("xray.importCsv", () => {
  it("previews the team's CSV without writing anything", async () => {
    const out = await run("xray.importCsv", { mode: "preview", file: CSV.pathname.replace(/^\/([A-Za-z]:)/, "$1") });
    expect(out.headers).toEqual(["Step", "Action", "Expected Result", "Exigence", "Source Reference"]);
    expect(out.tests).toHaveLength(1);
    expect(out.tests[0].steps).toHaveLength(5);
    expect(out.warnings[0]).toContain('"Source Reference" dropped');
    expect(out.written).toEqual([]);
    expect(listLocalTests(project)).toHaveLength(3);
  });

  it("local mode writes draft local tests and remembers the mapping", async () => {
    const text = readFileSync(CSV, "utf8");
    const out = await run("xray.importCsv", {
      text,
      name: "Sectionneur — vue de traction L92",
      folder: "/Traction/Sectionneurs",
    });
    expect(out.written).toHaveLength(1);
    const { test: t } = readTest(project, out.written[0]);
    expect(t).toMatchObject({
      project: "LFRPS12",
      summary: "Sectionneur — vue de traction L92",
      folder: "/Traction/Sectionneurs",
      review: "draft",
    });
    expect(t.steps).toHaveLength(5);
    expect(t.steps[1].fields.Exigence).toBe("EXI_MOP_SPF_511_A_1650, EXI_MOP_SPF_511_A_1660");
    expect(localTestRef(project, out.written[0])?.sync).toBe("local");
    expect(readProject(project).csvMapping).toEqual(out.mapping);

    const custom = await run("xray.importCsv", {
      mode: "preview",
      text: "N°;Quoi;Attendu\n1;a;r\n",
      mapping: { "N°": "#step", Quoi: "Action", Attendu: "Expected Result" },
    });
    expect(custom.tests[0].steps[0].fields).toEqual({ Action: "a", "Expected Result": "r" });
  });

  it("direct mode shows the plan on a dry run, then bulk-imports and pulls the created tests", async () => {
    const text = readFileSync(CSV, "utf8");
    const dry = await run("xray.importCsv", { mode: "direct", text, name: "L92", folder: "/Traction", dryRun: true });
    expect(dry.plan.map((o: any) => o.label)).toEqual([
      "Import 1 test into LFRPS12 (Xray bulk import)",
      "Pull the created tests",
    ]);
    expect(dry.written).toEqual([]);

    const out = await run("xray.importCsv", { mode: "direct", text, name: "L92", folder: "/Traction" });
    expect(out.written).toHaveLength(1);
    const jira = mockJiraTest(out.written[0])!;
    expect(jira).toMatchObject({ summary: "L92", folder: "/Traction", labels: ["testimus-draft"] });
    expect(jira.steps[4].custom["cf-exigence"]).toBe("EXI_MOP_SPF_511_A_1650");
    expect(localTestRef(project, out.written[0])).toMatchObject({ sync: "synced", review: "draft" });
  });
});
