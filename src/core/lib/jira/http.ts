import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";
import { scope, semaphore, sleep } from "../../../shared/run/work.ts";
import { env, type HttpReq, type HttpRes } from "../../env.ts";
import { jobNotice, jobSignal, notice } from "../../jobs.ts";
import { type JiraCreds, jiraCreds, xrayCreds } from "../creds.ts";
import { readJson, writeJson } from "../project.ts";

export type Myself = { accountId: string; displayName: string; emailAddress?: string };

let jwt = "";
let jwtFor = "";
let myselfCache: Myself | null = null;
let myselfFor = "";

export function resetAuth(): void {
  jwt = "";
  jwtFor = "";
  myselfCache = null;
  myselfFor = "";
}

export const browseUrl = (key: string) => `${jiraCreds().base}/browse/${key}`;

export const basic = (c: JiraCreds) => `Basic ${Buffer.from(`${c.email}:${c.token}`).toString("base64")}`;

// ponytail: Xray Cloud and Jira both meter the API and answer 429 — every request goes through here, so
// the whole backoff is one function: never more than six calls in the air, and a 429 is waited out for
// exactly as long as the server asks (Retry-After, seconds or an HTTP date) before being sent again.
// Nothing else is retried; a request still refused fails, and pushes resume from where they stopped.
const MAX_WAIT = 120;
const httpSlot = semaphore(6);

export function announceWait(secs: number): () => void {
  const message = `Rate limited — waiting ${secs}s`;
  const inJob = jobNotice(message);
  if (inJob) return inJob;
  notice(message);
  return () => notice("");
}

const headerOf = (h: Record<string, string>, name: string) =>
  h[name] ?? h[Object.keys(h).find((k) => k.toLowerCase() === name) ?? ""] ?? "";

export function retryAfter(headers: Record<string, string>, attempt: number): number {
  const raw = headerOf(headers, "retry-after").trim();
  const secs = Number(raw);
  if (raw && Number.isFinite(secs)) return Math.min(Math.max(secs, 0), MAX_WAIT);
  const at = raw ? Date.parse(raw) : Number.NaN;
  if (!Number.isNaN(at)) return Math.min(Math.max(Math.ceil((at - env.now().getTime()) / 1000), 1), MAX_WAIT);
  return Math.min(5 * 2 ** attempt, MAX_WAIT);
}

const commandSignal = new AsyncLocalStorage<AbortSignal>();

// ponytail: a read that is not a job (xray.search typed letter by letter) hands its command's signal to every request
// under it, so a page that gives up ends the fetch and the 429 wait, and its slot comes back at once
export function withSignal<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  return commandSignal.run(signal, work);
}

export async function send(req: HttpReq): Promise<HttpRes> {
  const all = [req.signal, commandSignal.getStore(), jobSignal()].filter((s): s is AbortSignal => !!s);
  const signal = all.length > 1 ? AbortSignal.any(all) : all[0];
  return httpSlot(async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await env.http({ ...req, signal });
      if (res.status !== 429 || attempt === 3) return res;
      const secs = retryAfter(res.headers, attempt);
      // ponytail: the wait holds its slot on purpose — being rate limited must slow everything down; a cancel ends it
      await scope(
        async (s) => {
          s.defer(announceWait(secs));
          await sleep(secs * 1000, s.signal);
        },
        { signal },
      );
    }
  }, signal);
}

export const RATE_LIMITED =
  "Xray/Jira rate limit reached and still refusing after three waits. Everything already applied stays — try again in a minute.";

/** Jira said no and said why (a permission of this issue: Add Comments, Assign…) — the message is the user's */
export class JiraRefused extends Error {}

function jiraMessages(text: string | undefined): string {
  try {
    const b = JSON.parse(text ?? "");
    return [...(b.errorMessages ?? []), ...Object.values(b.errors ?? {})].map(String).join(" ");
  } catch {
    return "";
  }
}

export async function jiraFetch(method: string, path: string, body?: unknown, what = path): Promise<any> {
  const c = jiraCreds();
  const res = await send({
    method,
    url: c.base + path,
    headers: {
      Authorization: basic(c),
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs: 60000,
  });
  if (res.status === 403) {
    // ponytail: a 403 that says why is a permission of this issue (Add Comments, Assign…), not the credentials
    const why = jiraMessages(res.text);
    if (why) throw new JiraRefused(`Jira refused ${what}: ${why}`);
  }
  if (res.status === 401 || res.status === 403)
    throw new Error(`Jira ${res.status} — check ~/.atlassian/credentials.json`);
  if (res.status === 404) throw new Error(`Jira 404 — ${what} not found`);
  if (res.status === 429) throw new Error(RATE_LIMITED);
  if (res.status >= 400) throw new Error(`Jira ${res.status} on ${what} — ${(res.text ?? "").slice(0, 300)}`);
  return res.text ? JSON.parse(res.text) : null;
}

export async function xrayJwt(force = false): Promise<string> {
  const c = xrayCreds();
  const who = `${c.apiBase}|${c.clientId}`;
  if (jwt && jwtFor === who && !force) return jwt;
  const res = await send({
    method: "POST",
    url: `${c.apiBase}/api/v2/authenticate`,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: c.clientId, client_secret: c.clientSecret }),
    timeoutMs: 60000,
  });
  if (res.status === 401) throw new Error("Xray 401 — check ~/.atlassian/xray_credentials.json (client id / secret)");
  if (res.status === 429) throw new Error(RATE_LIMITED);
  if (res.status >= 400)
    throw new Error(`Xray authentication failed (${res.status}) — ${(res.text ?? "").slice(0, 200)}`);
  jwt = (res.text ?? "").trim().replace(/^"|"$/g, "");
  jwtFor = who;
  if (!jwt) throw new Error("Xray authentication returned an empty token.");
  return jwt;
}

export async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const c = xrayCreds();
  const call = (token: string) =>
    send({
      method: "POST",
      url: `${c.apiBase}/api/v2/graphql`,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
      timeoutMs: 120000,
    });
  let res = await call(await xrayJwt());
  if (res.status === 401) res = await call(await xrayJwt(true));
  if (res.status === 401) throw new Error("Xray 401 — check ~/.atlassian/xray_credentials.json");
  if (res.status === 429) throw new Error(RATE_LIMITED);
  if (res.status >= 400) throw new Error(`Xray GraphQL ${res.status} — ${(res.text ?? "").slice(0, 300)}`);
  const body = JSON.parse(res.text ?? "{}");
  if (body.errors?.length)
    throw new Error(`Xray: ${body.errors.map((e: { message?: string }) => e.message ?? "error").join("; ")}`);
  return body.data as T;
}

export async function getMyself(): Promise<Myself> {
  const who = jiraCreds().email;
  if (myselfCache && myselfFor === who) return myselfCache;
  const m = await jiraFetch("GET", "/rest/api/3/myself", undefined, "your Jira account");
  myselfFor = who;
  myselfCache = { accountId: m.accountId, displayName: m.displayName, emailAddress: m.emailAddress };
  try {
    writeJson(meFile(), { email: who, ...myselfCache });
  } catch {}
  return myselfCache;
}

const meFile = () => join(env.dataDir(), "jira-me.json");

// ponytail: who « me » is without asking Jira — the account last read for these credentials, kept on disk so the
// assignee:me filter works offline; null when it was never read
export function knownMyself(): Myself | null {
  let who = "";
  try {
    who = jiraCreds().email;
  } catch {
    return null;
  }
  if (myselfCache && myselfFor === who) return myselfCache;
  const kept = readJson<(Myself & { email?: string }) | null>(meFile(), null);
  return kept?.accountId && kept.email === who
    ? { accountId: kept.accountId, displayName: kept.displayName, emailAddress: kept.emailAddress }
    : null;
}
