import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { env, type HttpReq } from "../../../../src/core/env.ts";
import { runDoctor, unused } from "../../../../src/core/lib/doctor.ts";
import { type ModelDeps, modelRows, NOTHING_YET } from "../../../../src/core/lib/doctor-models.ts";
import { listProjects } from "../../../../src/core/lib/jira/read.ts";
import { pinMachineProfile } from "../../../../src/core/lib/machine/profile.ts";
import { readSettings } from "../../../../src/core/lib/project.ts";
import { mockHttp } from "../../../../src/core/mock/jira.ts";
import type { DoctorCheck, MachineProfile } from "../../../../src/core/types.ts";

const saved = { http: env.http, spawn: env.spawnClaude };
let http: HttpReq[] = [];

const devPc = {
  system: { platform: "win32", arch: "x64" },
  ramTotalMB: 32768,
  ramFreeMB: 16384,
  cpu: { model: "Core", threads: 8 },
  gpus: [],
  drives: [],
} as unknown as MachineProfile;

const models = (over: Partial<ModelDeps> = {}): ModelDeps => ({
  machine: async () => devPc,
  active: async () => ({ embedding: null, reranker: null, wanted: [] }),
  space: async () => null,
  ...over,
});

const atl = () => join(env.homeDir(), ".atlassian");

beforeEach(() => {
  rmSync(atl(), { recursive: true, force: true });
  rmSync(join(env.dataDir(), "settings.json"), { force: true });
  pinMachineProfile(devPc);
  http = [];
  env.http = async (req) => {
    http.push(req);
    if (req.url.endsWith("/rest/api/3/myself"))
      return { status: 200, headers: {}, text: JSON.stringify({ displayName: "Tess" }) };
    if (req.url.endsWith("/api/v2/authenticate")) return { status: 200, headers: {}, text: '"jwt"' };
    if (req.url.includes("/rest/api/3/project/search")) {
      const start = Number(new URL(req.url).searchParams.get("startAt"));
      return {
        status: 200,
        headers: {},
        text: JSON.stringify(
          start === 0
            ? { isLast: false, values: [{ key: "A", name: "Alpha" }, { key: "B" }] }
            : { isLast: true, values: [{ key: "C", name: "Gamma" }] },
        ),
      };
    }
    throw new Error(`unexpected ${req.url}`);
  };
  env.spawnClaude = async () => ({ code: 0, stdout: "2.1.300 (Claude Code)\n", stderr: "" });
});

afterEach(() => {
  env.http = saved.http;
  env.spawnClaude = saved.spawn;
  pinMachineProfile(null);
});

const by = (rows: DoctorCheck[]) => Object.fromEntries(rows.map((r) => [r.id, r]));

describe("a service left out at the first launch", () => {
  it("system.set keeps the choice; the system check says not used instead of failing", async () => {
    let rows = by(await runDoctor({ project: null, claude: false, models: models(), timeoutMs: 2000 }));
    expect(rows.jira.state).toBe("fail");
    expect(rows.xray.state).toBe("fail");
    await invoke("system.set", { skipJira: true }, { project: null });
    expect(readSettings().atlassian).toEqual({ skipJira: true });
    rows = by(await runDoctor({ project: null, claude: false, models: models(), timeoutMs: 2000 }));
    expect(rows.jira).toMatchObject({
      state: "skip",
      detail: "not used: you chose to work without Jira",
      fix: "Connect it in Settings › Jira and Xray when you need it.",
      action: { command: "system.setCredentials" },
    });
    expect(rows.xray.state).toBe("skip");
  });

  it("Xray alone left out: Jira is still checked", async () => {
    await invoke("system.set", { skipXray: true }, { project: null });
    const rows = by(await runDoctor({ project: null, claude: false, models: models(), timeoutMs: 2000 }));
    expect(rows.jira.state).toBe("fail");
    expect(rows.xray).toMatchObject({ state: "skip", detail: expect.stringMatching(/tests are read, not pushed/) });
  });

  it("a row that works stays ok whatever was chosen", () => {
    const ok: DoctorCheck = { id: "jira", label: "Jira", state: "ok", detail: "Tess" };
    expect(unused(ok, true, "x")).toBe(ok);
    const fail: DoctorCheck = { id: "jira", label: "Jira", state: "fail", detail: "no" };
    expect(unused(fail, false, "x")).toBe(fail);
    expect(unused(fail, undefined, "x")).toBe(fail);
  });

  it("a connection that works clears the choice; one that fails keeps it", async () => {
    await invoke("system.set", { skipJira: true, skipXray: true }, { project: null });
    await invoke("system.setCredentials", { site: "acme", email: "a@b.c", token: "t" }, { project: null });
    expect(readSettings().atlassian).toEqual({ skipXray: true });
    await invoke("system.setCredentials", { clientId: "id", clientSecret: "s" }, { project: null });
    expect(readSettings().atlassian).toEqual({});
  });

  it("nothing changes when nothing was left out", async () => {
    await invoke("system.setCredentials", { site: "acme", email: "a@b.c", token: "t" }, { project: null });
    expect(readSettings().atlassian).toBeUndefined();
  });

  it("system.settings shows the choice", async () => {
    await invoke("system.set", { skipXray: true }, { project: null });
    const s = (await invoke("system.settings", {}, { project: null })) as { atlassian?: unknown };
    expect(s.atlassian).toEqual({ skipXray: true });
  });
});

describe("xray.projects", () => {
  it("lists every page Jira gives, by name, the key standing in for a missing name", async () => {
    await invoke("system.setCredentials", { site: "acme", email: "a@b.c", token: "t" }, { project: null });
    http = [];
    const r = await invoke("xray.projects", {}, { project: null });
    expect(r).toEqual([
      { key: "A", name: "Alpha" },
      { key: "B", name: "B" },
      { key: "C", name: "Gamma" },
    ]);
    expect(http.map((h) => new URL(h.url).searchParams.get("startAt"))).toEqual(["0", "2"]);
    expect(http[0].url).toContain("orderBy=name");
  });

  it("stops at the cap, and on an empty page", async () => {
    await invoke("system.setCredentials", { site: "acme", email: "a@b.c", token: "t" }, { project: null });
    expect(await listProjects(1)).toEqual([
      { key: "A", name: "Alpha" },
      { key: "B", name: "B" },
    ]);
    env.http = async () => ({ status: 200, headers: {}, text: JSON.stringify({ isLast: false, values: [] }) });
    expect(await listProjects()).toEqual([]);
  });

  it("the --mock Jira lists its project", async () => {
    const res = await mockHttp({ method: "GET", url: "https://mock.atlassian.net/rest/api/3/project/search" });
    const body = JSON.parse(res.text ?? "{}");
    expect(body.isLast).toBe(true);
    expect(body.values[0]).toMatchObject({ key: "LFRPS12" });
  });
});

describe("the vectors row of a project without documents", () => {
  it("is not a to-do", async () => {
    const rows = await modelRows("C:\\p", models({ space: async () => NOTHING_YET }));
    expect(rows.find((r) => r.id === "index.space")).toMatchObject({ state: "skip", detail: NOTHING_YET });
  });
});
