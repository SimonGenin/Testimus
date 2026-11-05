import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach } from "vitest";
import { env, type HttpReq, type HttpRes } from "../../../../src/core/env.ts";
import { resetAuth } from "../../../../src/core/lib/jira/http.ts";

export const JIRA = "https://t.atlassian.net";
export const XRAY = "https://xray.cloud.getxray.app";

export type Call = { method: string; url: string; headers: Record<string, string>; body: any };

// ponytail: a Jira + Xray that records every request; a test answers by setting route (any request), graph (the
// data of a GraphQL answer) or the authentication answer; every Xray folder exists but the missing ones, and the
// look-up a push makes before filing a test is left out of gqlCalls (folderChecks lists them)
export const fake = {
  calls: [] as Call[],
  route: (() => undefined) as (req: HttpReq, body: any) => HttpRes | undefined,
  graph: (() => ({})) as (query: string, vars: any) => unknown,
  authText: '"jwt-1"' as string | undefined,
  authStatus: 200,
  missingFolders: [] as string[],
};

export const ok = (body: unknown, status = 200): HttpRes => ({ status, headers: {}, text: JSON.stringify(body) });
export const status = (s: number, text?: string): HttpRes => ({ status: s, headers: { "retry-after": "0" }, text });
const folderCheck = (c: Call) => /\bgetFolder\([^)]*\)\{ path \}/.test(c.body?.query ?? "");
export const gqlCalls = () => fake.calls.filter((c) => c.url.endsWith("/graphql") && !folderCheck(c));
export const folderChecks = () => fake.calls.filter((c) => c.url.endsWith("/graphql") && folderCheck(c));

export function writeCreds(jira: unknown = { baseUrl: JIRA, email: "me@x.com", token: "tok" }) {
  const dir = join(env.homeDir(), ".atlassian");
  mkdirSync(dir, { recursive: true });
  if (jira === null) rmSync(join(dir, "credentials.json"), { force: true });
  else writeFileSync(join(dir, "credentials.json"), JSON.stringify(jira));
  writeFileSync(join(dir, "xray_credentials.json"), JSON.stringify({ clientId: "cid", clientSecret: "sec" }));
}

export function fakeXray(): void {
  const http = env.http;
  afterAll(() => {
    env.http = http;
  });
  beforeEach(() => {
    fake.calls = [];
    fake.route = () => undefined;
    fake.graph = () => ({});
    fake.authText = '"jwt-1"';
    fake.authStatus = 200;
    fake.missingFolders = [];
    resetAuth();
    writeCreds();
    env.http = async (req: HttpReq): Promise<HttpRes> => {
      const body = req.body ? JSON.parse(req.body) : undefined;
      fake.calls.push({ method: req.method, url: req.url, headers: req.headers ?? {}, body });
      const r = fake.route(req, body);
      if (r) return r;
      if (req.url.includes("/api/v2/authenticate"))
        return { status: fake.authStatus, headers: {}, text: fake.authText };
      if (req.url.endsWith("/graphql")) {
        const data = (fake.graph(body.query, body.variables) ?? {}) as Record<string, unknown>;
        if (folderCheck({ body } as Call) && !("getFolder" in data)) {
          const path = body.variables.path;
          if (fake.missingFolders.includes(path))
            return ok({ errors: [{ message: `Error getting folder: folder with path ${path} doesn't exist.` }] });
          data.getFolder = { path };
        }
        return ok({ data });
      }
      return ok({});
    };
  });
}
