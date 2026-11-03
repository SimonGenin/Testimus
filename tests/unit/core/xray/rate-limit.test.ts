import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { env, type HttpRes } from "../../../../src/core/env.ts";
import { resetAuth } from "../../../../src/core/lib/jira/http.ts";
import { fixtureCopy } from "../registry.ts";

const http = env.http;
let P = "";

afterAll(() => {
  env.http = http;
});

beforeEach(() => {
  P = fixtureCopy("rate-limit");
  const dir = join(env.homeDir(), ".atlassian");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "credentials.json"),
    JSON.stringify({ baseUrl: "https://mock.atlassian.net", email: "tester@example.com", token: "t" }),
  );
  writeFileSync(join(dir, "xray_credentials.json"), JSON.stringify({ clientId: "id", clientSecret: "secret" }));
  resetAuth();
});

describe("the wait for a Jira 429 (decision 9)", () => {
  it("ends at once when the command is cancelled, through the registry", async () => {
    let asked = 0;
    env.http = async (req): Promise<HttpRes> => {
      if (req.url.includes("authenticate")) return { status: 200, headers: {}, text: '"jwt"' };
      asked++;
      return { status: 429, headers: { "retry-after": "60" }, text: "" };
    };
    const ctrl = new AbortController();
    const run = invoke("xray.pull", { key: "LFRPS12-1398", overwrite: true }, { project: P, signal: ctrl.signal });
    run.catch(() => {});
    await vi.waitFor(() => expect(asked).toBe(1));
    const t0 = Date.now();
    ctrl.abort();
    await expect(run).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(asked).toBe(1);
  });
});
