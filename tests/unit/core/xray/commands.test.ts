import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../../../src/core/env.ts";
import { readColumns, setModes } from "../../../../src/core/lib/columns.ts";
import { resetAuth } from "../../../../src/core/lib/jira.ts";
import { readXray } from "../../../../src/core/lib/project.ts";
import { mockHttp, resetMockJira } from "../../../../src/core/mock/jira.ts";
import { call, fixtureCopy } from "../registry.ts";

const http = env.http;
let P = "";

afterAll(() => {
  env.http = http;
});

beforeEach(() => {
  P = fixtureCopy("xray-reg");
  const dir = join(env.homeDir(), ".atlassian");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "credentials.json"),
    JSON.stringify({ baseUrl: "https://mock.atlassian.net", email: "tester@example.com", token: "t" }),
  );
  writeFileSync(join(dir, "xray_credentials.json"), JSON.stringify({ clientId: "id", clientSecret: "secret" }));
  resetMockJira();
  resetAuth();
  env.http = mockHttp;
});

describe("xray.fields through the registry", () => {
  it("writes the step fields Xray has into xray.json, stamps the fetch and keeps the team's columns", async () => {
    setModes(P, { Exigence: "collapsed" });
    const columns = readColumns(P);
    const out = await call<{ fields: { name: string; builtin: boolean }[]; fetchedAt: string }>("xray.fields", {}, P);
    expect(out.fields.map((f) => [f.name, f.builtin])).toEqual([
      ["Action", true],
      ["Data", true],
      ["Expected Result", true],
      ["Exigence", false],
    ]);
    expect(Number.isNaN(Date.parse(out.fetchedAt))).toBe(false);
    expect(readXray(P)).toEqual({ fields: out.fields, fetchedAt: out.fetchedAt });
    expect(readColumns(P)).toEqual(columns);
    expect(existsSync(join(P, ".testimus", "jira-project.json"))).toBe(true);
  });

  it("refuses without a project, and says so when Jira refuses the credentials", async () => {
    await expect(call("xray.fields", {}, null)).rejects.toThrow(/No project is open/);
    env.http = async () => ({ status: 401, headers: {}, text: "" });
    await expect(call("xray.fields", {}, P)).rejects.toThrow(/credentials/i);
  });
});

describe("every xray command through the registry, its output checked against its schema", () => {
  it("xray.connect checks the key in Jira and saves it; xray.disconnect keeps it but stops every Jira call", async () => {
    expect(await call("xray.connect", { key: "lfrps12" }, P)).toEqual({ jiraProject: "LFRPS12", name: "RATP Sosie" });
    await expect(call("xray.connect", { key: "NOPE" }, P)).rejects.toThrow(/Jira 404/);
    await expect(call("xray.connect", { key: "1-x" }, P)).rejects.toThrow(/is not a Jira project key/);
    expect(await call("xray.disconnect", {}, P)).toEqual({ jiraProject: "LFRPS12" });
    await expect(call("xray.search", { text: "signal" }, P)).rejects.toThrow(/Jira is disconnected/);
    expect(await call("xray.connect", {}, P)).toEqual({ jiraProject: "LFRPS12", name: "RATP Sosie" });
  });

  it("xray.folders gives the folder tree with direct and total counts", async () => {
    const root = await call<{ path: string; totalCount: number; folders: { path: string; testsCount: number }[] }>(
      "xray.folders",
      {},
      P,
    );
    expect(root.path).toBe("/");
    expect(root.totalCount).toBe(6);
    expect(root.folders.map((f) => f.path)).toEqual(["/Signalisation", "/Traction"]);
    const sub = await call<{ path: string; folders: { path: string; testsCount: number }[] }>(
      "xray.folders",
      { path: "/Traction" },
      P,
    );
    expect(sub.folders.map((f) => [f.path, f.testsCount])).toEqual([
      ["/Traction/Disjoncteurs", 2],
      ["/Traction/Sectionneurs", 2],
    ]);
    await expect(call("xray.folders", { path: "/Nowhere" }, P)).rejects.toThrow(/does not exist/);
  });

  it("xray.search finds by text, by key or number, and lists a folder by pages", async () => {
    const byText = await call<{ tests: { key: string }[]; total: number }>("xray.search", { text: "Disjoncteur" }, P);
    expect(byText.tests.map((t) => t.key)).toEqual(["LFRPS12-1398", "LFRPS12-1401"]);
    expect(byText.total).toBe(2);
    const folder = await call<{ tests: { key: string; stepCount: number }[]; total: number }>(
      "xray.search",
      { folder: "/Signalisation" },
      P,
    );
    expect(folder.tests.map((t) => [t.key, t.stepCount])).toEqual([
      ["LFRPS12-1410", 1],
      ["LFRPS12-1411", 1],
    ]);
    expect((await call<{ tests: unknown[] }>("xray.search", { folder: "/", page: 1 }, P)).tests).toEqual([]);
  });

  it("xray.preconditions lists the project's preconditions by key", async () => {
    const out = await call<{ key: string }[]>("xray.preconditions", {}, P);
    expect(out.map((p) => p.key)).toEqual(["LFRPS12-77", "LFRPS12-78"]);
  });

  it("xray.browse answers the issue page without the network, and refuses what is not a key", async () => {
    env.http = async () => {
      throw new Error("no network");
    };
    expect(await call("xray.browse", { key: "lfrps12-1420" }, P)).toEqual({
      url: "https://mock.atlassian.net/browse/LFRPS12-1420",
    });
    await expect(call("xray.browse", { key: "1420" }, P)).rejects.toThrow(/is not an issue key/);
  });

  it("xray.pull runs as a job and reports what it pulled, skipped and failed", async () => {
    const out = await call<{ pulled: string[]; skipped: { key: string }[]; failed: { key: string }[] }>(
      "xray.pull",
      { keys: ["LFRPS12-1401", "LFRPS12-1420", "LFRPS12-9999"] },
      P,
    );
    expect(out.pulled).toEqual(["LFRPS12-1401"]);
    expect(out.skipped.map((s) => s.key)).toEqual(["LFRPS12-1420"]);
    expect(out.failed.map((s) => s.key)).toEqual(["LFRPS12-9999"]);
    await expect(call("xray.pull", {}, P)).rejects.toThrow(/Nothing to pull/);
  });

  it("xray.status of one test says its sync state and whether Jira moved", async () => {
    const out = await call<{ tests: unknown[] }>("xray.status", { id: "LFRPS12-1398" }, P);
    expect(out.tests).toEqual([{ id: "LFRPS12-1398", key: "LFRPS12-1398", sync: "synced", remote: "unchanged" }]);
    await expect(call("xray.status", { id: "local-00000000" }, P)).rejects.toThrow(/No test local-00000000/);
  });

  it("xray.push: a dry run gives the plan and its hash, a push without that hash is refused, with it the plan runs", async () => {
    const dry = await call<{ plan: { planHash: string; ops: { label: string }[] }; ops: { status: string }[] }>(
      "xray.push",
      { id: "LFRPS12-1420", dryRun: true },
      P,
    );
    expect(dry.plan.ops.map((o) => o.label)).toEqual([
      "Update labels (review label testimus-checked)",
      "Update step 2",
    ]);
    expect(dry.ops.map((o) => o.status)).toEqual(["not-started", "not-started"]);
    await expect(call("xray.push", { id: "LFRPS12-1420" }, P)).rejects.toThrow(/no planHash given/);
    await expect(call("xray.push", { id: "LFRPS12-1420", planHash: "0000" }, P)).rejects.toThrow(
      /changed since you saw the plan/,
    );
    const done = await call<{ ok: boolean; ops: { status: string }[] }>(
      "xray.push",
      { id: "LFRPS12-1420", planHash: dry.plan.planHash },
      P,
    );
    expect(done.ok).toBe(true);
    expect(done.ops.map((o) => o.status)).toEqual(["done", "done"]);
  });
});
