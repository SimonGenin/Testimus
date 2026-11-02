import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "../../src/core/commands/index.ts";
import { siteUrl } from "../../src/core/commands/system.ts";
import { env, type HttpReq } from "../../src/core/env.ts";
import { registryFile } from "../../src/core/lib/models-catalog.ts";
import { resolveInstalled } from "../../src/core/lib/models-resolve.ts";
import { findModel } from "../../src/core/lib/models-store.ts";
import { findProfile } from "../../src/core/rag/models.ts";

const atl = () => join(env.homeDir(), ".atlassian");
const jiraFile = () => join(atl(), "credentials.json");
const xrayFile = () => join(atl(), "xray_credentials.json");
const read = (f: string) => JSON.parse(readFileSync(f, "utf8"));

let calls: HttpReq[] = [];
const saved = { http: env.http };

function fakeHttp(myself = 200, auth = 200) {
  calls = [];
  env.http = async (req) => {
    calls.push(req);
    if (req.url.endsWith("/rest/api/3/myself"))
      return { status: myself, headers: {}, text: JSON.stringify({ displayName: "Tess Ter" }) };
    if (req.url.endsWith("/api/v2/authenticate")) return { status: auth, headers: {}, text: '"jwt-token"' };
    throw new Error(`unexpected ${req.method} ${req.url}`);
  };
}

beforeEach(() => {
  rmSync(atl(), { recursive: true, force: true });
  rmSync(join(env.dataDir(), "settings.json"), { force: true });
  delete process.env.TESTIMUS_JIRA_TOKEN;
  delete process.env.TESTIMUS_XRAY_SECRET;
  fakeHttp();
});

afterEach(() => {
  env.http = saved.http;
});

describe("siteUrl", () => {
  it("turns a tenant, host or URL into the /wiki base URL", () => {
    expect(siteUrl("acme")).toBe("https://acme.atlassian.net/wiki");
    expect(siteUrl("acme.atlassian.net")).toBe("https://acme.atlassian.net/wiki");
    expect(siteUrl("https://acme.atlassian.net/")).toBe("https://acme.atlassian.net/wiki");
    expect(siteUrl("https://jira.corp.local")).toBe("https://jira.corp.local");
  });
  it("keeps the previous spelling of the same site", () => {
    expect(siteUrl("https://acme.atlassian.net", "https://acme.atlassian.net/wiki")).toBe(
      "https://acme.atlassian.net/wiki",
    );
    expect(siteUrl("acme", "https://acme.atlassian.net")).toBe("https://acme.atlassian.net");
    expect(siteUrl("other", "https://acme.atlassian.net/wiki")).toBe("https://other.atlassian.net/wiki");
  });
});

describe("system.setup", () => {
  it("reports missing files and checks nothing when called empty", async () => {
    const r = (await invoke("system.setup", {}, { project: null })) as any;
    expect(r.status.jira).toMatchObject({ exists: false, complete: false });
    expect(r.status.xray).toMatchObject({ exists: false, complete: false });
    expect(r.saved).toEqual([]);
    expect(r.checks).toEqual([]);
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("reports complete files of a colleague who already has them", async () => {
    mkdirSync(atl(), { recursive: true });
    writeFileSync(
      jiraFile(),
      "\uFEFF" + JSON.stringify({ baseUrl: "https://acme.atlassian.net/wiki", email: "a@b.c", token: "t" }),
    );
    writeFileSync(xrayFile(), JSON.stringify({ clientId: "id", clientSecret: "s" }));
    const r = (await invoke("system.setup", {}, { project: null })) as any;
    expect(r.status.jira).toMatchObject({ exists: true, complete: true, baseUrl: "https://acme.atlassian.net/wiki" });
    expect(r.status.xray).toMatchObject({ exists: true, complete: true });
    expect(calls).toEqual([]);
  });

  it("merges into existing files, keeps unknown keys and /wiki, then checks read-only", async () => {
    mkdirSync(atl(), { recursive: true });
    writeFileSync(
      jiraFile(),
      JSON.stringify({ baseUrl: "https://acme.atlassian.net/wiki", email: "old@b.c", token: "old", accountId: "42" }),
    );
    writeFileSync(xrayFile(), JSON.stringify({ clientId: "id", apiBase: "https://eu.xray.cloud.getxray.app" }));
    const r = (await invoke(
      "system.setup",
      { site: "https://acme.atlassian.net", token: "new-token", clientSecret: "new-secret" },
      { project: null },
    )) as any;
    expect(read(jiraFile())).toEqual({
      baseUrl: "https://acme.atlassian.net/wiki",
      email: "old@b.c",
      token: "new-token",
      accountId: "42",
    });
    expect(read(xrayFile())).toEqual({
      clientId: "id",
      apiBase: "https://eu.xray.cloud.getxray.app",
      clientSecret: "new-secret",
    });
    expect(r.saved).toEqual(["baseUrl", "token", "clientSecret"]);
    expect(r.ok).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET https://acme.atlassian.net/rest/api/3/myself",
      "POST https://eu.xray.cloud.getxray.app/api/v2/authenticate",
    ]);
    expect(calls[0].headers?.Authorization).toBe(`Basic ${Buffer.from("old@b.c:new-token").toString("base64")}`);
    expect(JSON.parse(calls[1].body ?? "{}")).toEqual({ client_id: "id", client_secret: "new-secret" });
    expect(JSON.stringify(r)).not.toMatch(/new-token|new-secret/);
  });

  it("creates the files from scratch and takes secrets from the environment", async () => {
    process.env.TESTIMUS_JIRA_TOKEN = "env-token";
    process.env.TESTIMUS_XRAY_SECRET = "env-secret";
    const r = (await invoke(
      "system.setup",
      { site: "acme", email: "me@acme.com", clientId: "cid" },
      { project: null },
    )) as any;
    expect(read(jiraFile())).toEqual({
      baseUrl: "https://acme.atlassian.net/wiki",
      email: "me@acme.com",
      token: "env-token",
    });
    expect(read(xrayFile())).toEqual({ clientId: "cid", clientSecret: "env-secret" });
    expect(r.status.jira.complete && r.status.xray.complete).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("says what to fix when Jira refuses the token", async () => {
    fakeHttp(401, 200);
    const r = (await invoke(
      "system.setup",
      { site: "acme", email: "me@acme.com", token: "bad", clientId: "cid", clientSecret: "s" },
      { project: null },
    )) as any;
    expect(r.ok).toBe(false);
    const jira = r.checks.find((c: any) => c.id === "jira");
    expect(jira.state).toBe("fail");
    expect(jira.detail).toMatch(/401 — check ~\/.atlassian\/credentials.json/);
    expect(jira.fix).toMatch(/api-tokens/);
    expect(r.checks.find((c: any) => c.id === "xray").state).toBe("ok");
  });
});

describe("system settings", () => {
  it("reads defaults and saves only the fields given", async () => {
    const s0 = (await invoke("system.settings", {}, { project: null })) as any;
    expect(s0).toMatchObject({ theme: "system", stepLayout: "stacked", models: { allowRemote: true } });
    await invoke("system.saveSettings", { theme: "dark", allowRemote: false }, { project: null });
    const exe = join(mkdtempSync(join(tmpdir(), "testimus-exe-")), "claude.exe");
    writeFileSync(exe, "");
    const s1 = (await invoke("system.saveSettings", { claudeExe: ` ${exe} ` }, { project: null })) as any;
    expect(s1).toMatchObject({ theme: "dark", stepLayout: "stacked", claude: { exe } });
    expect(s1.models.allowRemote).toBe(false);
    expect(read(join(env.dataDir(), "settings.json")).theme).toBe("dark");
  });

  it("refuses a claude.exe that is not an existing executable path", async () => {
    for (const claudeExe of ["echo INJECTED & rem", "C:\\nowhere\\claude.exe", "claude"])
      await expect(invoke("system.saveSettings", { claudeExe }, { project: null })).rejects.toThrow(/full path/);
  });

  it("refuses a Jira site or an Xray API outside Atlassian unless confirmed", async () => {
    await expect(invoke("system.setup", { site: "https://collector.evil.example" }, { project: null })).rejects.toThrow(
      /not an Atlassian Cloud site/,
    );
    await expect(
      invoke("system.setup", { apiBase: "https://collector.evil.example" }, { project: null }),
    ).rejects.toThrow(/not an Xray Cloud address/);
  });
});

describe("system.pullModel", () => {
  it("refuses an unknown profile and a download when allowRemote is off", async () => {
    await expect(invoke("system.pullModel", { profile: "nope" }, { project: null, wait: true })).rejects.toThrow(
      /Unknown model profile/,
    );
    await invoke("system.saveSettings", { allowRemote: false }, { project: null });
    const p = findProfile("bge-m3")!;
    if (findModel(p.hfId, p.dtype)) return;
    const prev = process.env.TESTIMUS_MODELS;
    process.env.TESTIMUS_MODELS = join(env.localDir(), "empty-models");
    try {
      await expect(invoke("system.pullModel", { profile: "bge-m3" }, { project: null, wait: true })).rejects.toThrow(
        /downloads are off/,
      );
    } finally {
      if (prev === undefined) delete process.env.TESTIMUS_MODELS;
      else process.env.TESTIMUS_MODELS = prev;
    }
  });
});

describe("system.pullModel — alias of models.pull", () => {
  it("takes a profile name or catalog id, and stops before any download when the models folder is not chosen", async () => {
    rmSync(registryFile(), { force: true });
    const prev = process.env.TESTIMUS_MODELS;
    process.env.TESTIMUS_MODELS = join(env.localDir(), "empty-models");
    try {
      expect(resolveInstalled("qwen3-embedding-0.6b-q8")).toBeNull();
      await expect(
        invoke("system.pullModel", { profile: "qwen3-embedding-0.6b-q8" }, { project: null, wait: true }),
      ).rejects.toThrow(/Choose where models are stored: `testimus models setDir <folder>`/);
    } finally {
      if (prev === undefined) delete process.env.TESTIMUS_MODELS;
      else process.env.TESTIMUS_MODELS = prev;
    }
  });
});

describe("system.version", () => {
  it("reads the package version and the face", async () => {
    const v = (await invoke("system.version", {}, { project: null })) as any;
    expect(v.version).toBe(JSON.parse(readFileSync("package.json", "utf8")).version);
    expect(existsSync("package.json")).toBe(true);
    expect(v.shell).toBe("browser");
    const prev = process.env.TESTIMUS_SHELL;
    process.env.TESTIMUS_SHELL = "desktop/0.2.0";
    try {
      expect(((await invoke("system.version", {}, { project: null })) as any).shell).toBe("desktop 0.2.0");
    } finally {
      if (prev === undefined) delete process.env.TESTIMUS_SHELL;
      else process.env.TESTIMUS_SHELL = prev;
    }
  });
});
