import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type Ctx, quietCtx } from "../../src/core/command.ts";
import { commands, importPoll } from "../../src/core/commands/xray.ts";
import { env, type HttpReq } from "../../src/core/env.ts";
import { resetAuth } from "../../src/core/lib/jira.ts";
import { mockHttp, resetMockJira } from "../../src/core/mock/jira.ts";
import { copyFixture, FIXTURE, tempRoot } from "./cov-faces-helpers.ts";

const http = env.http;
const poll = { ...importPoll };
let project = "";
let logs: string[] = [];

const statuses: Record<string, unknown> = {
  "job-pending": { status: "working" },
  "job-failed": { status: "failed", result: { errors: ["bad row"], issues: [] } },
  "job-empty": { status: "successful", result: {} },
  "job-ghost": {
    status: "partially_successful",
    result: { issues: [{ key: "LFRPS12-99999", id: "1" }], errors: [{ errors: { m: "x" } }], warnings: ["careful"] },
  },
};

const trap = { armed: false, wrote: false };

async function fakeJira(req: HttpReq) {
  if (trap.armed) {
    const read = req.method === "GET" || /^\s*query/.test(String(JSON.parse(req.body || "{}").query ?? ""));
    if (trap.wrote && read && !req.url.includes("/authenticate")) throw "Jira went away";
    if (!read && !req.url.includes("/authenticate")) trap.wrote = true;
  }
  const m = /\/import\/test\/bulk\/([^/]+)\/status$/.exec(new URL(req.url).pathname);
  if (m && m[1] in statuses) return { status: 200, headers: {}, text: JSON.stringify(statuses[m[1]]) };
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
  Object.assign(importPoll, poll);
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
  Object.assign(importPoll, { tries: 2, everyMs: 1 });
});

describe("xray job subjects", () => {
  it("names pull, push and import jobs", () => {
    expect(subject("xray.pull", { key: "LFRPS12-1" })).toBe("LFRPS12-1");
    expect(subject("xray.pull", { keys: ["A-1", "A-2"] })).toBe("A-1, A-2");
    expect(subject("xray.pull", { keys: [], folder: "/F" })).toBe("/F");
    expect(subject("xray.pull", {})).toBe("");
    expect(subject("xray.push", { id: "local-1" })).toBe("local-1");
    expect(subject("xray.importCsv", { file: "a.csv" })).toBe("a.csv");
    expect(subject("xray.importCsv", { name: "N" })).toBe("N");
    expect(subject("xray.importCsv", {})).toBe("csv");
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

describe("xray.importCsv edge cases", () => {
  it("needs a file or a text, a readable file and a header row", async () => {
    await expect(run("xray.importCsv", { mode: "preview" })).rejects.toThrow("Nothing to import.");
    await expect(run("xray.importCsv", { mode: "preview", file: join(project, "missing.csv") })).rejects.toThrow(
      /^Cannot read /,
    );
    await expect(run("xray.importCsv", { mode: "preview", text: "" })).rejects.toThrow("The CSV is empty.");
  });

  it("hands the job id back while Xray is still importing", async () => {
    const r = await run("xray.importCsv", { mode: "direct", jobId: "job-pending" });
    expect(r.jobId).toBe("job-pending");
    expect(r.warnings[0]).toContain("Xray is still importing (job job-pending, working)");
  });

  it("stops polling when cancelled", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(run("xray.importCsv", { mode: "direct", jobId: "job-pending" }, ctxOf(ctrl.signal))).rejects.toThrow(
      "Import cancelled while Xray was still importing (job job-pending).",
    );
  });

  it("reports a failed or empty import", async () => {
    await expect(run("xray.importCsv", { mode: "direct", jobId: "job-failed" })).rejects.toThrow(
      "Xray bulk import failed: bad row.",
    );
    await expect(run("xray.importCsv", { mode: "direct", jobId: "job-empty" })).rejects.toThrow(
      "Xray bulk import successful: no test created.",
    );
  });

  it("keeps going when a created test cannot be pulled", async () => {
    const r = await run("xray.importCsv", { mode: "direct", jobId: "job-ghost" });
    expect(r.written).toEqual([]);
    expect(r.warnings).toEqual([
      'Xray import error: {"m":"x"}',
      "careful",
      expect.stringContaining("LFRPS12-99999 was created but could not be pulled"),
    ]);
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

describe("xray.importCsv direct plan", () => {
  it("names the import of several tests in the plural", async () => {
    const text = ["Summary,Step,Action,Expected Result", "First,1,a1,r1", "Second,1,b1,r2", ""].join("\n");
    const r = await run("xray.importCsv", { mode: "direct", text, dryRun: true });
    expect(r.plan[0].label).toBe("Import 2 tests into LFRPS12 (Xray bulk import)");
  });
});

describe("xray.prefs and xray.search defaults", () => {
  it("keeps every pref when none is given", async () => {
    const before = JSON.parse(readFileSync(join(project, "xray.json"), "utf8")).prefs;
    const r = await run("xray.prefs", {});
    expect(r.prefs).toEqual(before);
  });

  it("lists the root folder when neither text nor folder is given", async () => {
    const r = await run("xray.search", { text: "  " });
    expect(r.tests).toHaveLength(r.total);
  });
});
