import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { env, type HttpReq, type HttpRes } from "../../../../src/core/env.ts";
import { jobNotice, startJob, subscribe } from "../../../../src/core/jobs.ts";
import { credsDir } from "../../../../src/core/lib/creds.ts";
import { announceWait, resetAuth } from "../../../../src/core/lib/jira/http.ts";
import { getProjectInfo } from "../../../../src/core/lib/jira/read.ts";
import type { JobEvent } from "../../../../src/core/types.ts";
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

describe("the wait for a Jira 429 outside a job follows the command's signal (review 4)", () => {
  const reads: Array<[string, Record<string, unknown>]> = [
    ["xray.search", { text: "sectionneur" }],
    ["xray.folders", {}],
    ["xray.status", { id: "LFRPS12-1398" }],
    ["xray.preconditions", {}],
  ];

  for (const [name, input] of reads)
    it(`${name}: a 429 Retry-After 60 ends at once when the request is cancelled`, async () => {
      let asked = 0;
      env.http = async (req): Promise<HttpRes> => {
        if (req.url.includes("authenticate")) return { status: 200, headers: {}, text: '"jwt"' };
        asked++;
        return { status: 429, headers: { "retry-after": "60" }, text: "" };
      };
      const ctrl = new AbortController();
      const run = invoke(name, input, { project: P, signal: ctrl.signal });
      run.catch(() => {});
      await vi.waitFor(() => expect(asked).toBe(1));
      const t0 = Date.now();
      ctrl.abort();
      await expect(run).rejects.toThrow();
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(asked).toBe(1);
    });

  it("the fetch itself is aborted with the request", async () => {
    let seen: AbortSignal | undefined;
    env.http = (req): Promise<HttpRes> => {
      if (req.url.includes("authenticate")) return Promise.resolve({ status: 200, headers: {}, text: '"jwt"' });
      seen = req.signal;
      return new Promise((_, reject) => req.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    };
    const ctrl = new AbortController();
    const run = invoke("xray.search", { text: "sectionneur" }, { project: P, signal: ctrl.signal });
    run.catch(() => {});
    await vi.waitFor(() => expect(seen).toBeDefined());
    ctrl.abort();
    await expect(run).rejects.toThrow();
    expect(seen?.aborted).toBe(true);
  });

  it("six abandoned searches give their slots back at once: the next request is not held", async () => {
    let limited = true;
    let asked = 0;
    env.http = async (req): Promise<HttpRes> => {
      if (req.url.includes("authenticate")) return { status: 200, headers: {}, text: '"jwt"' };
      asked++;
      if (limited) return { status: 429, headers: { "retry-after": "60" }, text: "" };
      return {
        status: 200,
        headers: {},
        text: JSON.stringify({ data: { getPreconditions: { total: 0, results: [] } } }),
      };
    };
    mkdirSync(join(P, ".testimus"), { recursive: true });
    writeFileSync(
      join(P, ".testimus", "jira-project.json"),
      JSON.stringify({ key: "LFRPS12", id: "10001", name: "LFRPS12", testIssueTypeId: "9" }),
    );
    const ctrls = Array.from({ length: 6 }, () => new AbortController());
    const runs = ctrls.map((c, i) => invoke("xray.search", { text: `s${i}` }, { project: P, signal: c.signal }));
    for (const r of runs) r.catch(() => {});
    await vi.waitFor(() => expect(asked).toBe(6));
    for (const c of ctrls) c.abort();
    await Promise.allSettled(runs);
    limited = false;
    const t0 = Date.now();
    expect(await invoke("xray.preconditions", {}, { project: P })).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("rate limits", () => {
  const http = env.http;
  afterEach(() => {
    env.http = http;
    rmSync(credsDir(), { recursive: true, force: true });
    resetAuth();
  });

  it("a running job says it waits, then puts its line back", async () => {
    mkdirSync(credsDir(), { recursive: true });
    writeFileSync(
      join(credsDir(), "credentials.json"),
      JSON.stringify({ baseUrl: "https://a.atlassian.net", email: "e", token: "t" }),
    );
    let n = 0;
    env.http = async (_req: HttpReq): Promise<HttpRes> => {
      n++;
      if (n === 1) return { status: 429, headers: { "Retry-After": "0" }, text: "" };
      return {
        status: 200,
        headers: {},
        text: JSON.stringify({ id: 1, key: "K", issueTypes: [{ id: "9", name: "Test" }] }),
      };
    };
    const seen: JobEvent[] = [];
    const off = subscribe((e) => seen.push(e));
    const { done } = startJob("pull", "K", P, async (ctx) => {
      ctx.progress({ message: "Pulling", done: 1, total: 4 });
      return getProjectInfo("K");
    });
    expect(await done).toMatchObject({ key: "K" });
    off();
    const lines = seen.filter((e) => e.type === "progress").map((e) => (e.type === "progress" ? e : null));
    expect(lines.map((e) => e?.message)).toEqual(["Pulling", "Rate limited — waiting 0s", "Pulling"]);
    expect(lines[1]).toMatchObject({ done: 1, total: 4 });
  });

  it("outside a job the wait goes to every open page as a notice, taken down when it ends", () => {
    expect(jobNotice("x")).toBeUndefined();
    const seen: JobEvent[] = [];
    const off = subscribe((e) => seen.push(e));
    const resume = announceWait(5);
    expect(seen.at(-1)).toMatchObject({ jobId: "", type: "notice", message: "Rate limited — waiting 5s" });
    expect(typeof resume).toBe("function");
    (resume as () => void)();
    expect(seen.at(-1)).toMatchObject({ type: "notice", message: "" });
    off();
  });
});
