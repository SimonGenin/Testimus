import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type Ctx, quietCtx } from "../../src/core/command.ts";
import { commands } from "../../src/core/commands/xray.ts";
import { env, type HttpReq } from "../../src/core/env.ts";
import { setModes, stepColumns } from "../../src/core/lib/columns.ts";
import { resetAuth } from "../../src/core/lib/jira/http.ts";
import { mockHttp, resetMockJira } from "../../src/core/mock/jira.ts";
import { copyFixture, FIXTURE, tempRoot } from "./cov-faces-helpers.ts";

const http = env.http;
let project = "";
let logs: string[] = [];

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
  project = copyFixture(tempRoot("xray"), "LFRPS12");
  const dir = join(env.homeDir(), ".atlassian");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "credentials.json"),
    JSON.stringify({ baseUrl: "https://mock.atlassian.net/wiki", email: "tester@example.com", token: "t" }),
  );
  writeFileSync(join(dir, "xray_credentials.json"), JSON.stringify({ clientId: "id", clientSecret: "secret" }));
  resetMockJira();
  resetAuth();
  env.http = fakeJira;
  logs = [];
  trap.armed = false;
  trap.wrote = false;
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
