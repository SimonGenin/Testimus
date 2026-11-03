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
