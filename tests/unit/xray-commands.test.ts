import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { quietCtx } from "../../src/core/command.ts";
import { commands } from "../../src/core/commands/xray.ts";
import { env } from "../../src/core/env.ts";
import { readColumns, saveColumn, setModes, setOrder } from "../../src/core/lib/columns.ts";
import { resetAuth } from "../../src/core/lib/jira.ts";
import { readXray } from "../../src/core/lib/project.ts";
import { listLocalTests, localTestRef, readTest, writeTest } from "../../src/core/lib/store.ts";
import { mockHttp, mockJira, mockJiraTest, resetMockJira } from "../../src/core/mock/jira.ts";

const FIXTURE = new URL("../fixtures/project/", import.meta.url);
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

  it("xray.fields fetches the step schema and keeps the team's columns", async () => {
    setModes(project, { Exigence: "collapsed" });
    const before = readColumns(project);
    const out = await run("xray.fields");
    expect(out.fields).toEqual([
      { id: "action", name: "Action", type: "text", builtin: true },
      { id: "data", name: "Data", type: "text", builtin: true },
      { id: "result", name: "Expected Result", type: "text", builtin: true },
      { id: "cf-exigence", name: "Exigence", type: "text-single", builtin: false },
    ]);
    expect(readXray(project)).toEqual(out);
    expect(readColumns(project)).toEqual(before);
    expect(existsSync(join(project, ".testimus/jira-project.json"))).toBe(true);
  });

  it("columns.order and columns.setModes set order, folded and hidden columns, and refuse a name that is not a column", () => {
    const out = setOrder(project, ["Exigence", "Action"]);
    expect(out.map((c) => c.name)).toEqual(["Exigence", "Action", "Data", "Expected Result"]);
    const hidden = setModes(project, { Data: "hidden" });
    expect(hidden.map((c) => [c.name, c.mode])).toEqual([
      ["Exigence", "open"],
      ["Action", "open"],
      ["Data", "hidden"],
      ["Expected Result", "open"],
    ]);
    expect(readColumns(project).find((c) => c.name === "Data")?.mode).toBe("hidden");
    expect(setModes(project, { Data: "filled" }).find((c) => c.name === "Data")?.mode).toBe("filled");
    expect(() => setModes(project, { Priorité: "collapsed" })).toThrow("Not a step column of this project: Priorité.");
  });

  it("columns.setModes accepts a local smart column, kept in columns.json and not in Xray", () => {
    saveColumn(project, { name: "Alarme", description: "Le code d'alarme affiché" });
    const out = setModes(project, { Data: "filled", Alarme: "filled" });
    expect(out.filter((c) => c.mode === "filled").map((c) => c.name)).toEqual(["Data", "Alarme"]);
    expect(readColumns(project).find((c) => c.name === "Alarme")).toMatchObject({ mode: "filled" });
    expect(readXray(project).fields.some((f) => f.name === "Alarme")).toBe(false);
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
