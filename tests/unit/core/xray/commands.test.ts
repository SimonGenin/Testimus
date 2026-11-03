import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { type Ctx, quietCtx } from "../../../../src/core/command.ts";
import { commands } from "../../../../src/core/commands/xray.ts";
import { env, type HttpReq } from "../../../../src/core/env.ts";
import { readColumns, saveColumn, setModes, setOrder, stepColumns } from "../../../../src/core/lib/columns.ts";
import { resetAuth } from "../../../../src/core/lib/jira/http.ts";
import { readXray } from "../../../../src/core/lib/project.ts";
import { listLocalTests, localTestRef, readTest, writeTest } from "../../../../src/core/lib/store.ts";
import { mockHttp, mockJira, mockJiraTest, resetMockJira } from "../../../../src/core/mock/jira.ts";
import { call, FIXTURE } from "../registry.ts";

const http = env.http;
let project = "";
let logs: string[] = [];

// ponytail: armed, the fake Jira answers writes and then goes away for reads — a push whose refresh fails
const trap = { armed: false, wrote: false };

async function fakeJira(req: HttpReq) {
  if (trap.armed) {
    const read = req.method === "GET" || /^\s*query/.test(String(JSON.parse(req.body || "{}").query ?? ""));
    if (trap.wrote && read && !req.url.includes("/authenticate")) throw "Jira went away";
    if (!read && !req.url.includes("/authenticate")) trap.wrote = true;
  }
  return mockHttp(req);
}

const cmd = (name: string) => {
  const c = commands.find((x) => x.name === name);
  if (!c) throw new Error(`no ${name}`);
  return c;
};
const ctxOf = (signal?: AbortSignal): Ctx => ({
  ...quietCtx(project, signal),
  log: (_l, m) => logs.push(m),
});
const run = async (name: string, raw: unknown = {}, ctx: Ctx = ctxOf()): Promise<any> => {
  const c = cmd(name);
  return c.run(ctx, c.input.parse(raw) as never);
};
const subject = (name: string, raw: unknown) => cmd(name).subject?.(cmd(name).input.parse(raw) as never);

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
  env.http = fakeJira;
  logs = [];
  trap.armed = false;
  trap.wrote = false;
});

describe("xray.refreshFields through the registry", () => {
  it("writes the step fields Xray has into xray.json, stamps the fetch and keeps the team's columns", async () => {
    setModes(project, { Exigence: "collapsed" });
    const columns = readColumns(project);
    const out = await call<{ fields: { name: string; builtin: boolean }[]; fetchedAt: string }>(
      "xray.refreshFields",
      {},
      project,
    );
    expect(out.fields.map((f) => [f.name, f.builtin])).toEqual([
      ["Action", true],
      ["Data", true],
      ["Expected Result", true],
      ["Exigence", false],
    ]);
    expect(Number.isNaN(Date.parse(out.fetchedAt))).toBe(false);
    expect(readXray(project)).toEqual({ fields: out.fields, fetchedAt: out.fetchedAt });
    expect(readColumns(project)).toEqual(columns);
    expect(existsSync(join(project, ".testimus", "jira-project.json"))).toBe(true);
  });

  it("refuses without a project, and says so when Jira refuses the credentials", async () => {
    await expect(call("xray.refreshFields", {}, null)).rejects.toThrow(/No project is open/);
    env.http = async () => ({ status: 401, headers: {}, text: "" });
    await expect(call("xray.refreshFields", {}, project)).rejects.toThrow(/credentials/i);
  });
});

describe("xray.fields reads xray.json and asks Xray nothing", () => {
  it("answers what the last refresh wrote, even with Jira unreachable", async () => {
    const before = readXray(project);
    env.http = async () => {
      throw new Error("no network");
    };
    expect(await call("xray.fields", {}, project)).toEqual(before);
    env.http = mockHttp;
    const fresh = await call("xray.refreshFields", {}, project);
    env.http = async () => {
      throw new Error("no network");
    };
    expect(await call("xray.fields", {}, project)).toEqual(fresh);
  });
});

describe("xray.statusAll checks every test as a job", () => {
  it("re-checks each synced test", async () => {
    mockJiraTest("LFRPS12-1398")!.summary = "Changed by someone else";
    const out = await call<{ tests: { id: string; remote: string }[] }>("xray.statusAll", {}, project);
    expect(out.tests.map((t) => [t.id, t.remote])).toEqual([
      ["LFRPS12-1398", "remote-changed"],
      ["LFRPS12-1420", "unchanged"],
      ["local-3f9a12c0", "unverified"],
    ]);
  });

  it("ends at once when cancelled", async () => {
    env.http = (req) =>
      new Promise((_, reject) => req.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    const ctrl = new AbortController();
    const run = call("xray.statusAll", {}, project, { signal: ctrl.signal });
    run.catch(() => {});
    ctrl.abort();
    await expect(run).rejects.toThrow();
  });
});

describe("every xray command through the registry, its output checked against its schema", () => {
  it("xray.connect checks the key in Jira and saves it; xray.disconnect keeps it but stops every Jira call", async () => {
    expect(await call("xray.connect", { key: "lfrps12" }, project)).toEqual({
      jiraProject: "LFRPS12",
      name: "RATP Sosie",
    });
    await expect(call("xray.connect", { key: "NOPE" }, project)).rejects.toThrow(/Jira 404/);
    await expect(call("xray.connect", { key: "1-x" }, project)).rejects.toThrow(/is not a Jira project key/);
    expect(await call("xray.disconnect", {}, project)).toEqual({ jiraProject: "LFRPS12" });
    await expect(call("xray.search", { text: "signal" }, project)).rejects.toThrow(/Jira is disconnected/);
    expect(await call("xray.connect", {}, project)).toEqual({ jiraProject: "LFRPS12", name: "RATP Sosie" });
  });

  it("xray.folders gives the folder tree with direct and total counts", async () => {
    const root = await call<{ path: string; totalCount: number; folders: { path: string; testsCount: number }[] }>(
      "xray.folders",
      {},
      project,
    );
    expect(root.path).toBe("/");
    expect(root.totalCount).toBe(6);
    expect(root.folders.map((f) => f.path)).toEqual(["/Signalisation", "/Traction"]);
    const sub = await call<{ path: string; folders: { path: string; testsCount: number }[] }>(
      "xray.folders",
      { path: "/Traction" },
      project,
    );
    expect(sub.folders.map((f) => [f.path, f.testsCount])).toEqual([
      ["/Traction/Disjoncteurs", 2],
      ["/Traction/Sectionneurs", 2],
    ]);
    await expect(call("xray.folders", { path: "/Nowhere" }, project)).rejects.toThrow(/does not exist/);
  });

  it("xray.search finds by text, by key or number, and lists a folder by pages", async () => {
    const byText = await call<{ tests: { key: string }[]; total: number }>(
      "xray.search",
      { text: "Disjoncteur" },
      project,
    );
    expect(byText.tests.map((t) => t.key)).toEqual(["LFRPS12-1398", "LFRPS12-1401"]);
    expect(byText.total).toBe(2);
    const folder = await call<{ tests: { key: string; stepCount: number }[]; total: number }>(
      "xray.search",
      { folder: "/Signalisation" },
      project,
    );
    expect(folder.tests.map((t) => [t.key, t.stepCount])).toEqual([
      ["LFRPS12-1410", 1],
      ["LFRPS12-1411", 1],
    ]);
    expect((await call<{ tests: unknown[] }>("xray.search", { folder: "/", page: 1 }, project)).tests).toEqual([]);
  });

  it("xray.preconditions lists the project's preconditions by key", async () => {
    const out = await call<{ key: string }[]>("xray.preconditions", {}, project);
    expect(out.map((p) => p.key)).toEqual(["LFRPS12-77", "LFRPS12-78"]);
  });

  it("xray.browse answers the issue page without the network, and refuses what is not a key", async () => {
    env.http = async () => {
      throw new Error("no network");
    };
    expect(await call("xray.browse", { key: "lfrps12-1420" }, project)).toEqual({
      url: "https://mock.atlassian.net/browse/LFRPS12-1420",
    });
    await expect(call("xray.browse", { key: "1420" }, project)).rejects.toThrow(/is not an issue key/);
  });

  it("xray.pull runs as a job and reports what it pulled, skipped and failed", async () => {
    const out = await call<{ pulled: string[]; skipped: { key: string }[]; failed: { key: string }[] }>(
      "xray.pull",
      { keys: ["LFRPS12-1401", "LFRPS12-1420", "LFRPS12-9999"] },
      project,
    );
    expect(out.pulled).toEqual(["LFRPS12-1401"]);
    expect(out.skipped.map((s) => s.key)).toEqual(["LFRPS12-1420"]);
    expect(out.failed.map((s) => s.key)).toEqual(["LFRPS12-9999"]);
    await expect(call("xray.pull", {}, project)).rejects.toThrow(/Nothing to pull/);
  });

  it("xray.status of one test says its sync state and whether Jira moved", async () => {
    const out = await call<{ tests: unknown[] }>("xray.status", { id: "LFRPS12-1398" }, project);
    expect(out.tests).toEqual([{ id: "LFRPS12-1398", key: "LFRPS12-1398", sync: "synced", remote: "unchanged" }]);
    await expect(call("xray.status", { id: "local-00000000" }, project)).rejects.toThrow(/No test local-00000000/);
  });

  it("xray.push: a dry run gives the plan and its hash, a push without that hash is refused, with it the plan runs", async () => {
    const dry = await call<{ plan: { planHash: string; ops: { label: string }[] }; ops: { status: string }[] }>(
      "xray.push",
      { id: "LFRPS12-1420", dryRun: true },
      project,
    );
    expect(dry.plan.ops.map((o) => o.label)).toEqual([
      "Update labels (review label testimus-checked)",
      "Update step 2",
    ]);
    expect(dry.ops.map((o) => o.status)).toEqual(["not-started", "not-started"]);
    await expect(call("xray.push", { id: "LFRPS12-1420" }, project)).rejects.toThrow(/no planHash given/);
    await expect(call("xray.push", { id: "LFRPS12-1420", planHash: "0000" }, project)).rejects.toThrow(
      /changed since you saw the plan/,
    );
    const done = await call<{ ok: boolean; ops: { status: string }[] }>(
      "xray.push",
      { id: "LFRPS12-1420", planHash: dry.plan.planHash },
      project,
    );
    expect(done.ok).toBe(true);
    expect(done.ops.map((o) => o.status)).toEqual(["done", "done"]);
  });
});

describe("xray commands", () => {
  it("every input field is described", () => {
    for (const c of commands) {
      const shape = (c.input as any).shape as Record<string, { description?: string }>;
      for (const [k, v] of Object.entries(shape)) expect(v.description, `${c.name} ${k}`).toBeTruthy();
    }
  });

  it("every output field is described, down to the nested ones", () => {
    const undescribed = (s: any, at: string, defs: Record<string, any>, seen: Set<string>): string[] => {
      if (s?.$ref) {
        const name = String(s.$ref).split("/").pop() ?? "";
        if (seen.has(name)) return [];
        seen.add(name);
        return undescribed(defs[name], at, defs, seen);
      }
      if (s?.type === "array") return undescribed(s.items, `${at}[]`, defs, seen);
      if (s?.type !== "object") return [];
      return Object.entries(s.properties ?? {}).flatMap(([k, v]: [string, any]) => [
        ...(v.description ? [] : [`${at}.${k}`]),
        ...undescribed(v, `${at}.${k}`, defs, seen),
      ]);
    };
    for (const c of commands) {
      const json = z.toJSONSchema(c.output, { io: "output" }) as any;
      expect(undescribed(json, c.name, json.$defs ?? json.definitions ?? {}, new Set()), c.name).toEqual([]);
    }
  });

  it("xray.refreshFields fetches the step schema and keeps the team's columns", async () => {
    setModes(project, { Exigence: "collapsed" });
    const before = readColumns(project);
    const out = await run("xray.refreshFields");
    expect(await run("xray.fields")).toEqual(out);
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

  it("xray.statusAll and xray.status re-check Jira and reports a remote change", async () => {
    mockJiraTest("LFRPS12-1398")!.summary = "Changed by someone else";
    const out = await run("xray.statusAll");
    expect(out.tests).toEqual([
      { id: "LFRPS12-1398", key: "LFRPS12-1398", sync: "remote-changed", remote: "remote-changed" },
      { id: "LFRPS12-1420", key: "LFRPS12-1420", sync: "modified", remote: "unchanged" },
      { id: "local-3f9a12c0", sync: "local", remote: "unverified" },
    ]);
    expect((await run("xray.status", { id: "LFRPS12-1420" })).tests).toHaveLength(1);
  });

  it("xray.plan and a dry run write nothing, and give the same plan", async () => {
    const plan = await run("xray.plan", { id: "LFRPS12-1420" });
    expect(plan.ops.map((o: any) => o.label)).toEqual([
      "Update labels (review label testimus-checked)",
      "Update step 2",
    ]);
    const dry = await run("xray.push", { id: "LFRPS12-1420", dryRun: true });
    expect(dry.ops.map((o: any) => o.status)).toEqual(["not-started", "not-started"]);
    expect(dry.plan).toEqual(plan);
    expect(mockJiraTest("LFRPS12-1420")!.labels).toEqual(["testimus-draft"]);
  });

  it("xray.push reports per-op results, stops at the failing op and resumes from it", async () => {
    const { test: t } = readTest(project, "LFRPS12-1398");
    mkdirSync(join(project, "tests/LFRPS12-1398/images"), { recursive: true });
    writeFileSync(
      join(project, "tests/LFRPS12-1398/images/img-0000bbbb.png"),
      readFileSync(join(FIXTURE, "tests/LFRPS12-1420/images/fig-40.png")),
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

describe("xray job subjects", () => {
  it("names pull and push jobs", () => {
    expect(subject("xray.pull", { key: "LFRPS12-1" })).toBe("LFRPS12-1");
    expect(subject("xray.pull", { keys: ["A-1", "A-2"] })).toBe("A-1, A-2");
    expect(subject("xray.pull", { keys: [], folder: "/F" })).toBe("/F");
    expect(subject("xray.pull", {})).toBe("");
    expect(subject("xray.push", { id: "local-1" })).toBe("local-1");
  });
});

describe("xray.pull edge cases", () => {
  it("refuses nothing to pull", async () => {
    await expect(run("xray.pull", { keys: [" "] })).rejects.toThrow("Nothing to pull.");
  });

  it("skips never-synced local copies and lists failures, sorted by key", async () => {
    for (const key of ["LFRPS12-5001", "LFRPS12-5000"]) {
      cpSync(join(FIXTURE, "tests", "local-3f9a12c0"), join(project, "tests", key), { recursive: true });
    }
    const r = await run("xray.pull", {
      keys: ["lfrps12-5001", "LFRPS12-5000", "LFRPS12-99998", "LFRPS12-99997", "bad key!"],
    });
    expect(r.pulled).toEqual([]);
    expect(r.skipped.map((s: { key: string }) => s.key)).toEqual(["LFRPS12-5000", "LFRPS12-5001"]);
    expect(r.skipped[0].reason).toContain("never synced");
    expect(r.failed.map((f: { key: string }) => f.key)).toEqual(["BAD KEY!", "LFRPS12-99997", "LFRPS12-99998"]);
    expect(logs.length).toBe(3);
  });

  it("stops at the first failure once cancelled", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(run("xray.pull", { key: "LFRPS12-1420", overwrite: true }, ctxOf(ctrl.signal))).rejects.toThrow();
  });
});

describe("xray.status, browse and preconditions", () => {
  it("refuses an unknown test", async () => {
    await expect(run("xray.status", { id: "local-00000000" })).rejects.toThrow(
      "No test local-00000000 in this project.",
    );
  });

  it("gives the browse link of a key, refuses what is not a key", async () => {
    const r = await run("xray.browse", { key: " lfrps12-1420 " });
    expect(r.url).toMatch(/\/browse\/LFRPS12-1420$/);
    await expect(run("xray.browse", { key: "not a key" })).rejects.toThrow('"not a key" is not an issue key.');
  });

  it("lists the project's preconditions", async () => {
    const list = await run("xray.preconditions");
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toHaveProperty("key");
  });
});

describe("xray.push without a stopped push in memory", () => {
  it("rebuilds the plan and says so", async () => {
    const r = await run("xray.push", { id: "local-3f9a12c0", dryRun: true, from: 1 });
    expect(r.ok).toBe(true);
    expect(r.ops.every((o: { status: string }) => o.status === "not-started")).toBe(true);
    expect(logs).toContain("No stopped push of this test in memory — the plan is rebuilt and run from its first op.");
  });
});

describe("xray.push whose refresh fails", () => {
  it("is pushed, with a warning and the refresh error", async () => {
    const { planHash } = await run("xray.plan", { id: "LFRPS12-1420" });
    trap.armed = true;
    const r = await run("xray.push", { id: "LFRPS12-1420", planHash });
    expect(r.ok).toBe(true);
    expect(r.error).toBe("Pushed; refreshing from Jira failed — Jira went away");
    expect(logs).toContain("Pushed, but the refresh from Jira failed: Jira went away");
  });
});

describe("columns.setModes and xray.search defaults", () => {
  it("keeps every column when no mode is given", () => {
    const before = stepColumns(project);
    expect(setModes(project, {})).toEqual(before);
  });

  it("lists the root folder when neither text nor folder is given", async () => {
    const r = await run("xray.search", { text: "  " });
    expect(r.tests).toHaveLength(r.total);
  });
});
