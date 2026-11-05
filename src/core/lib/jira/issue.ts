import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { adfToText, textToAdf } from "../adf.ts";
import { writeAtomic } from "../atomic.ts";
import { jiraOwned, patchFrontmatter } from "../review.ts";
import { testDir } from "../store.ts";
import { getMyself, jiraFetch } from "./http.ts";

// ponytail: the Jira side of a test that is not its content — its workflow status, who it is assigned to, its
// comments. Each write goes to Jira at once (never through a push); what Jira owns in test.md follows it

const at = (key: string) => `/rest/api/3/issue/${encodeURIComponent(key)}`;

export type StatusCategory = "new" | "indeterminate" | "done";
export type Transition = { id: string; name: string; to: string; category: StatusCategory };
export type Person = { accountId: string; name: string };
export type IssueState = { status: string; category: StatusCategory; assignee: Person | null };
export type JiraComment = {
  id: string;
  author: Person | null;
  mine: boolean;
  body: string;
  created: string;
  updated: string;
};

const categoryOf = (s: { statusCategory?: { key?: string } } | undefined): StatusCategory => {
  const k = s?.statusCategory?.key;
  return k === "new" || k === "done" ? k : "indeterminate";
};

const personOf = (p: { accountId?: string; displayName?: string } | null | undefined): Person | null =>
  p?.accountId ? { accountId: String(p.accountId), name: String(p.displayName ?? p.accountId) } : null;

export async function issueState(key: string): Promise<IssueState> {
  const i = await jiraFetch("GET", `${at(key)}?fields=status,assignee`, undefined, `issue ${key}`);
  const f = i?.fields ?? {};
  return { status: String(f.status?.name ?? ""), category: categoryOf(f.status), assignee: personOf(f.assignee) };
}

export async function transitionsOf(key: string): Promise<Transition[]> {
  const d = await jiraFetch("GET", `${at(key)}/transitions`, undefined, `the transitions of ${key}`);
  return (d?.transitions ?? []).map((t: any) => ({
    id: String(t.id),
    name: String(t.name ?? ""),
    to: String(t.to?.name ?? ""),
    category: categoryOf(t.to),
  }));
}

export async function transition(key: string, id: string): Promise<void> {
  await jiraFetch("POST", `${at(key)}/transitions`, { transition: { id } }, `the move of ${key}`);
}

export async function assignable(key: string, query: string): Promise<Person[]> {
  const q = new URLSearchParams({ issueKey: key, query, maxResults: "20" });
  const d = await jiraFetch("GET", `/rest/api/3/user/assignable/search?${q}`, undefined, `the people of ${key}`);
  return (Array.isArray(d) ? d : [])
    .filter((p: any) => p.active !== false)
    .map(personOf)
    .filter((p: Person | null): p is Person => !!p);
}

export async function assign(key: string, accountId: string | null): Promise<void> {
  await jiraFetch("PUT", `${at(key)}/assignee`, { accountId }, `the assignee of ${key}`);
}

export async function comments(key: string): Promise<JiraComment[]> {
  const [d, me] = await Promise.all([
    jiraFetch("GET", `${at(key)}/comment?orderBy=created&maxResults=100`, undefined, `the comments of ${key}`),
    getMyself(),
  ]);
  return (d?.comments ?? []).map((c: any) => commentOf(c, me.accountId));
}

function commentOf(c: any, me: string): JiraComment {
  const author = personOf(c.author);
  return {
    id: String(c.id),
    author,
    mine: author?.accountId === me,
    body: adfToText(c.body, { mentions: true }),
    created: String(c.created ?? ""),
    updated: String(c.updated ?? c.created ?? ""),
  };
}

export async function addComment(key: string, text: string): Promise<JiraComment> {
  const [c, me] = await Promise.all([
    jiraFetch("POST", `${at(key)}/comment`, { body: textToAdf(text, { mentions: true }) }, `a comment on ${key}`),
    getMyself(),
  ]);
  return commentOf(c, me.accountId);
}

export async function editComment(key: string, id: string, text: string): Promise<JiraComment> {
  const [c, me] = await Promise.all([
    jiraFetch("PUT", `${at(key)}/comment/${id}`, { body: textToAdf(text, { mentions: true }) }, `comment ${id}`),
    getMyself(),
  ]);
  return commentOf(c, me.accountId);
}

export async function deleteComment(key: string, id: string): Promise<void> {
  await jiraFetch("DELETE", `${at(key)}/comment/${id}`, undefined, `comment ${id}`);
}

// ponytail: the local copy of a pulled test follows Jira — test.md and .remote.md both, so the test stays « In sync »
// and a later pull finds nothing new; a test that is not in this project is left alone
export function reflect(project: string, key: string, s: IssueState): boolean {
  const want = jiraOwned({
    status: s.status || null,
    assignee: s.assignee?.name ?? null,
    assigneeId: s.assignee?.accountId ?? null,
  });
  let touched = false;
  for (const name of ["test.md", ".remote.md"]) {
    const file = join(testDir(project, key), name);
    if (!existsSync(file)) continue;
    const md = readFileSync(file, "utf8");
    const next = patchFrontmatter(md, want, "Jira changed, the local copy did not follow", "pull the test again");
    if (next !== md) writeAtomic(file, next);
    touched = true;
  }
  return touched;
}
