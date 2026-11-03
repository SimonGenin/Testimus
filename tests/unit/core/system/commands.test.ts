import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { probeDeps } from "../../../../src/core/claude/limits.ts";
import { agentProbe } from "../../../../src/core/commands/system.ts";
import { env } from "../../../../src/core/env.ts";
import { mockProbeDeps } from "../../../../src/core/mock/agents.ts";
import { indexFile } from "../../../../src/core/rag/db.ts";
import { call, fixtureCopy } from "../registry.ts";

const atl = () => join(env.homeDir(), ".atlassian");
const saved = { http: env.http };

beforeEach(() => {
  rmSync(atl(), { recursive: true, force: true });
  rmSync(join(env.dataDir(), "settings.json"), { force: true });
  env.http = async (req) => {
    if (req.url.endsWith("/rest/api/3/myself")) return { status: 200, headers: {}, text: '{"displayName":"Tess"}' };
    if (req.url.endsWith("/api/v2/authenticate")) return { status: 200, headers: {}, text: '"jwt"' };
    throw new Error(`unexpected ${req.method} ${req.url}`);
  };
});
afterEach(() => {
  env.http = saved.http;
  agentProbe.deps = probeDeps;
});

describe("system.* through the registry, each output against its schema", () => {
  it("system.version names Testimus, Node and the face", async () => {
    const v = await call<{ version: string; node: string; shell: string }>("system.version", {}, null);
    expect(v.node).toBe(process.version);
    expect(v.shell).toBe("browser");
  });

  it("system.credentials reads the files only; with check it also checks them, read-only", async () => {
    const empty = await call<{ checks: unknown[]; ok: boolean; status: { jira: { exists: boolean } } }>(
      "system.credentials",
      {},
      null,
    );
    expect(empty).toMatchObject({ checks: [], ok: false, status: { jira: { exists: false } } });
    mkdirSync(atl(), { recursive: true });
    writeFileSync(
      join(atl(), "credentials.json"),
      JSON.stringify({ baseUrl: "https://acme.atlassian.net", email: "a@b.c", token: "t" }),
    );
    writeFileSync(join(atl(), "xray_credentials.json"), JSON.stringify({ clientId: "i", clientSecret: "s" }));
    const checked = await call<{ checks: { id: string; state: string }[]; ok: boolean }>(
      "system.credentials",
      { check: true },
      null,
    );
    expect(checked.checks.map((c) => [c.id, c.state])).toEqual([
      ["jira", "ok"],
      ["xray", "ok"],
    ]);
    expect(checked.ok).toBe(true);
  });

  it("system.setCredentials saves, checks, and never gives a secret back; system.secrets does, off MCP", async () => {
    const r = await call<{ saved: string[]; ok: boolean }>(
      "system.setCredentials",
      { site: "acme", email: "a@b.c", token: "tok-1", clientId: "cid", clientSecret: "sec-1" },
      null,
    );
    expect(r.saved).toEqual(["baseUrl", "email", "token", "clientId", "clientSecret"]);
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/tok-1|sec-1/);
    expect(await call("system.secrets", {}, null)).toEqual({ token: "tok-1", clientId: "cid", clientSecret: "sec-1" });
  });

  it("system.set and system.settings keep the global settings", async () => {
    const s = await call<{ agents?: { max?: number } }>("system.set", { agentsMax: 3, allowRemote: false }, null);
    expect(s.agents?.max).toBe(3);
    expect(await call("system.settings", {}, null)).toMatchObject({
      agents: { max: 3 },
      models: { allowRemote: false },
    });
    const file = JSON.parse(readFileSync(join(env.dataDir(), "settings.json"), "utf8"));
    expect(file.agents.max).toBe(3);
  });

  it("system.doctor gives one row per check", async () => {
    const d = await call<{ ok: boolean; checks: { id: string }[] }>("system.doctor", {}, null);
    expect(d.checks.length).toBeGreaterThan(3);
    expect(new Set(d.checks.map((c) => c.id)).size).toBe(d.checks.length);
  }, 60000);

  it("system.testAgents measures with the probe it is given and saves the limit", async () => {
    const p = fixtureCopy("sys-reg");
    mkdirSync(dirname(indexFile(p)), { recursive: true });
    writeFileSync(indexFile(p), "");
    agentProbe.deps = () => mockProbeDeps(0);
    const r = await call<{ limit: number; applied: boolean }>("system.testAgents", {}, p, { wait: true });
    expect(r).toMatchObject({ limit: 10, applied: true });
    expect(await call("system.settings", {}, null)).toMatchObject({ agents: { max: 10 } });
  });
});
