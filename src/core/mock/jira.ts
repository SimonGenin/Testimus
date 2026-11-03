import { sleep } from "../../shared/run/work.ts";
import { env, type HttpReq, type HttpRes } from "../env.ts";
import { adfToText, textToAdf } from "../lib/adf.ts";
import { graphql, json } from "./jira/graphql.ts";
import { MOCK_JWT, MOCK_ME, MOCK_PROJECT, type MTest, mockJira, st } from "./jira/state.ts";

export { MOCK_JIRA, MOCK_JWT, mockJira, mockJiraTest, resetMockJira } from "./jira/state.ts";

const empty = (status: number): HttpRes => ({ status, headers: {}, text: "" });
const notFound = (what: string) => json({ errorMessages: [`${what} does not exist`] }, 404);

function issueJson(t: MTest) {
  return {
    id: t.issueId,
    key: t.key,
    fields: {
      summary: t.summary,
      labels: t.labels,
      status: { name: t.status },
      description: t.description ? textToAdf(t.description) : null,
      issuelinks: t.links.map((l, i) => ({
        id: String(70000 + i),
        type: { name: l.type },
        outwardIssue: { key: l.key },
      })),
    },
  };
}

// ponytail: a Jira REST + Xray GraphQL server in memory — `serve --mock` puts it in env.http, unit tests too
export async function mockHttp(req: HttpReq): Promise<HttpRes> {
  const ms = mockJira.latencyMs;
  if (env.mock) await sleep(req.url.includes("/attachment/content/") ? ms * 5 : ms, req.signal);
  const url = new URL(req.url);
  const path = decodeURIComponent(url.pathname);
  const body = () => JSON.parse(req.body || "{}");
  const s = st();

  if (path === "/api/v2/authenticate" && req.method === "POST") {
    const b = body();
    if (!b.client_id || !b.client_secret) return json({ error: "Authentication failed" }, 401);
    return { status: 200, headers: {}, text: JSON.stringify(MOCK_JWT) };
  }
  if (path === "/api/v2/graphql" && req.method === "POST") {
    if ((req.headers?.Authorization ?? "") !== `Bearer ${MOCK_JWT}`) return json({ error: "Unauthorized" }, 401);
    const b = body();
    return graphql(String(b.query ?? ""), b.variables ?? {});
  }

  if (path === "/rest/api/3/myself") return json(MOCK_ME);
  const proj = /^\/rest\/api\/3\/project\/([^/]+)$/.exec(path);
  if (proj) {
    if (proj[1] !== MOCK_PROJECT.key && proj[1] !== MOCK_PROJECT.id) return notFound(`Project ${proj[1]}`);
    return json({
      id: MOCK_PROJECT.id,
      key: MOCK_PROJECT.key,
      name: MOCK_PROJECT.name,
      issueTypes: [
        { id: "10001", name: "Task" },
        { id: MOCK_PROJECT.testTypeId, name: "Xray Test" },
        { id: "10936", name: "Precondition" },
      ],
    });
  }
  const att = /^\/rest\/api\/3\/attachment\/content\/([^/]+)$/.exec(path);
  if (att) {
    const bytes = s.files.get(att[1]);
    if (!bytes) return notFound(`Attachment ${att[1]}`);
    return req.binary
      ? { status: 200, headers: { "content-type": "image/png" }, bytes }
      : { status: 200, headers: {}, text: "" };
  }
  const issue = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(path);
  if (issue) {
    const t = s.tests.get(issue[1]);
    if (!t) return notFound(`Issue ${issue[1]}`);
    if (req.method === "GET") return json(issueJson(t));
    if (req.method === "PUT") {
      const f = body().fields ?? {};
      if (f.summary !== undefined) t.summary = f.summary;
      if (f.labels !== undefined) t.labels = f.labels;
      if (f.description !== undefined) t.description = adfToText(f.description);
      return empty(204);
    }
  }
  if (path === "/rest/api/3/issueLink" && req.method === "POST") {
    const b = body();
    const from = s.tests.get(b.inwardIssue?.key);
    if (!from) return notFound(`Issue ${b.inwardIssue?.key}`);
    if (!from.links.some((l) => l.type === b.type?.name && l.key === b.outwardIssue?.key))
      from.links.push({ type: b.type?.name, key: b.outwardIssue?.key });
    return empty(201);
  }
  return json({ error: `mock: no fixture for ${req.method} ${req.url}` }, 404);
}
