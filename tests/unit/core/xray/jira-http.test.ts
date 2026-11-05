import { describe, expect, it } from "vitest";
import { env, type HttpRes } from "../../../../src/core/env.ts";
import { subscribe } from "../../../../src/core/jobs.ts";
import { getMyself, resetAuth } from "../../../../src/core/lib/jira/http.ts";
import { getFolderTree, getProjectInfo } from "../../../../src/core/lib/jira/read.ts";

import { fake, fakeXray, gqlCalls, JIRA, ok, status } from "./fake-xray.ts";

fakeXray();

describe("jira REST errors", () => {
  it("a 429 still refused after three waits fails with the rate limit message", async () => {
    fake.route = (req) => (req.url.startsWith(JIRA) ? status(429) : undefined);
    await expect(getMyself()).rejects.toThrow(/rate limit/);
    expect(fake.calls).toHaveLength(4);
  });

  it("another error status quotes the answer, or nothing when there is none", async () => {
    fake.route = (req) => (req.url.startsWith(JIRA) ? status(500) : undefined);
    await expect(getMyself()).rejects.toThrow(/^Jira 500 on your Jira account — $/);
    fake.route = (req) => (req.url.startsWith(JIRA) ? status(400, "bad") : undefined);
    await expect(getProjectInfo("X")).rejects.toThrow("Jira 400 on project X — bad");
  });

  it("an empty answer reads as null", async () => {
    fake.route = (req) => (req.url.startsWith(JIRA) ? status(200, "") : undefined);
    await expect(getMyself()).rejects.toThrow(TypeError);
  });

  it("a 403 names the Jira credentials file", async () => {
    fake.route = (req) => (req.url.startsWith(JIRA) ? status(403, "forbidden") : undefined);
    await expect(getMyself()).rejects.toThrow(/^Jira 403 — check ~\/\.atlassian\/credentials\.json$/);
    expect(fake.calls).toHaveLength(1);
  });

  it("never has more than six requests in the air", async () => {
    const held: ((r: HttpRes) => void)[] = [];
    env.http = (req) => {
      fake.calls.push({ method: req.method, url: req.url, headers: req.headers ?? {}, body: undefined });
      return new Promise<HttpRes>((r) => held.push(r));
    };
    const tick = async () => {
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    };
    const all = Array.from({ length: 8 }, () => {
      resetAuth();
      return getMyself();
    });
    await tick();
    expect(held).toHaveLength(6);
    held[0](ok({ accountId: "a", displayName: "A" }));
    await tick();
    expect(held).toHaveLength(7);
    for (let i = 1; i < held.length; i++) held[i](ok({ accountId: "a", displayName: "A" }));
    await tick();
    expect(held).toHaveLength(8);
    for (const r of held) r(ok({ accountId: "a", displayName: "A" }));
    await Promise.all(all);
  });

  it("getMyself is cached per account", async () => {
    fake.route = (req) => (req.url.endsWith("/myself") ? ok({ accountId: "a1", displayName: "Me" }) : undefined);
    const a = await getMyself();
    const b = await getMyself();
    expect(b).toBe(a);
    expect(fake.calls).toHaveLength(1);
  });
});

describe("xray authentication", () => {
  it("a 401 names the xray credentials file", async () => {
    fake.authStatus = 401;
    await expect(getFolderTree("1")).rejects.toThrow("Xray 401 — check ~/.atlassian/xray_credentials.json (client id");
  });

  it("another failure quotes the answer, empty or not", async () => {
    fake.authStatus = 500;
    fake.authText = undefined;
    await expect(getFolderTree("1")).rejects.toThrow(/^Xray authentication failed \(500\) — $/);
    fake.authText = "down";
    await expect(getFolderTree("1")).rejects.toThrow("Xray authentication failed (500) — down");
  });

  it("a 429 that does not go away fails with the rate limit message, not as a failed authentication", async () => {
    fake.route = (req) => (req.url.includes("/api/v2/authenticate") ? status(429) : undefined);
    await expect(getFolderTree("1")).rejects.toThrow(/rate limit/);
  });

  it("an empty token is refused", async () => {
    fake.authText = '""';
    await expect(getFolderTree("1")).rejects.toThrow("empty token");
    fake.authText = undefined;
    await expect(getFolderTree("1")).rejects.toThrow("empty token");
  });
});

describe("xray token", () => {
  it("is fetched once and reused across calls, and fetched again only after a 401", async () => {
    const tree = { getFolder: { name: "/", path: "/", testsCount: 0, folders: [] } };
    fake.graph = () => tree;
    const auths = () => fake.calls.filter((c) => c.url.includes("/api/v2/authenticate")).length;
    const bearers = () => gqlCalls().map((c) => c.headers.Authorization);
    await getFolderTree("1");
    await getFolderTree("1");
    await getFolderTree("1");
    expect(auths()).toBe(1);
    expect(bearers()).toEqual(["Bearer jwt-1", "Bearer jwt-1", "Bearer jwt-1"]);
    let refused = false;
    fake.authText = '"jwt-2"';
    fake.route = (req) => {
      if (!req.url.endsWith("/graphql") || refused) return undefined;
      refused = true;
      return status(401);
    };
    await getFolderTree("1");
    expect(auths()).toBe(2);
    await getFolderTree("1");
    expect(auths()).toBe(2);
    expect(bearers().slice(3)).toEqual(["Bearer jwt-1", "Bearer jwt-2", "Bearer jwt-2"]);
  });
});

describe("graphql errors", () => {
  it("two 401 in a row fail", async () => {
    fake.route = (req) => (req.url.endsWith("/graphql") ? status(401) : undefined);
    await expect(getFolderTree("1")).rejects.toThrow("Xray 401 — check ~/.atlassian/xray_credentials.json");
    expect(fake.calls.filter((c) => c.url.includes("authenticate"))).toHaveLength(2);
  });

  it("a 429 that does not go away fails with the rate limit message", async () => {
    let waits = 0;
    const off = subscribe((e) => {
      if (e.type === "notice" && e.message.startsWith("Rate limited")) waits++;
    });
    fake.route = (req) => (req.url.endsWith("/graphql") ? status(429) : undefined);
    await expect(getFolderTree("1")).rejects.toThrow(/rate limit/);
    off();
    expect(waits).toBe(3);
  });

  it("a server error quotes the answer, empty or not", async () => {
    fake.route = (req) => (req.url.endsWith("/graphql") ? status(502) : undefined);
    await expect(getFolderTree("1")).rejects.toThrow(/^Xray GraphQL 502 — $/);
  });

  it("errors in the body are joined, an error without message says error", async () => {
    fake.route = (req) => (req.url.endsWith("/graphql") ? ok({ errors: [{ message: "a" }, {}] }) : undefined);
    await expect(getFolderTree("1")).rejects.toThrow("Xray: a; error");
  });

  it("an empty body reads as no data", async () => {
    fake.route = (req) => (req.url.endsWith("/graphql") ? status(200) : undefined);
    await expect(getFolderTree("1")).rejects.toThrow(TypeError);
  });
});
