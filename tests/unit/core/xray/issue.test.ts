import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { quietCtx, UserError } from "../../../../src/core/command.ts";
import { commands } from "../../../../src/core/commands/issue.ts";
import { env, type HttpReq } from "../../../../src/core/env.ts";
import { knownMyself, resetAuth } from "../../../../src/core/lib/jira/http.ts";
import { readProject, writeProject } from "../../../../src/core/lib/project.ts";
import { readTest, testDir } from "../../../../src/core/lib/store.ts";
import { mockHttp, mockJira, mockJiraTest, resetMockJira } from "../../../../src/core/mock/jira.ts";
import { FIXTURE } from "../registry.ts";

const http = env.http;
let project = "";
let sent: HttpReq[] = [];

const run = async (name: string, raw: unknown = {}): Promise<any> => {
  const c = commands.find((x) => x.name === name);
  if (!c) throw new Error(`no ${name}`);
  return c.run(quietCtx(project), c.input.parse(raw) as never);
};
const writes = () => sent.filter((r) => r.method !== "GET" && !r.url.includes("/authenticate"));
const md = (key: string, file = "test.md") => readFileSync(join(testDir(project, key), file), "utf8");

afterAll(() => {
  env.http = http;
});

beforeEach(() => {
  project = join(mkdtempSync(join(tmpdir(), "testimus-issue-")), "LFRPS12");
  cpSync(FIXTURE, project, { recursive: true });
  const dir = join(env.homeDir(), ".atlassian");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "credentials.json"),
    JSON.stringify({ baseUrl: "https://mock.atlassian.net/wiki", email: "tester@example.com", token: "t" }),
  );
  writeFileSync(join(dir, "xray_credentials.json"), JSON.stringify({ clientId: "id", clientSecret: "secret" }));
  resetMockJira();
  resetAuth();
  mockJira.refuseComments = false;
  sent = [];
  env.http = (req) => {
    sent.push(req);
    return mockHttp(req);
  };
});

describe("issue.transitions and issue.transition", () => {
  it("lists where the issue can go, from its status now", async () => {
    const out = await run("issue.transitions", { key: "lfrps12-1420" });
    expect(out.status).toBe("To Do");
    expect(out.category).toBe("new");
    expect(out.transitions.map((t: { name: string; to: string }) => `${t.name} → ${t.to}`)).toEqual([
      "Start testing → In Progress",
      "Mark as done → Done",
      "Block → Blocked",
    ]);
    expect(writes()).toEqual([]);
  });

  it("a dry run says from where to where and writes nothing", async () => {
    const out = await run("issue.transition", { key: "LFRPS12-1420", transition: "11", dryRun: true });
    expect(out).toMatchObject({ dryRun: true, from: "To Do", to: "In Progress", name: "Start testing", local: false });
    expect(writes()).toEqual([]);
    expect(mockJiraTest("LFRPS12-1420")?.status).toBe("To Do");
  });

  it("moves the issue, writes the new status in test.md and .remote.md, and names the way back", async () => {
    const before = md("LFRPS12-1420").replace(/^status: .*$/m, "");
    const out = await run("issue.transition", { key: "LFRPS12-1420", transition: "Start testing" });
    expect(out).toMatchObject({ dryRun: false, from: "To Do", to: "In Progress", status: "In Progress", local: true });
    expect(out.undo).toMatchObject({ name: "Back to To Do", to: "To Do" });
    expect(mockJiraTest("LFRPS12-1420")?.status).toBe("In Progress");
    expect(readTest(project, "LFRPS12-1420").test.status).toBe("In Progress");
    expect(md("LFRPS12-1420", ".remote.md")).toMatch(/^status: In Progress$/m);
    expect(md("LFRPS12-1420").replace(/^status: .*$/m, "")).toBe(before);
    expect(writes().map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "POST /rest/api/3/issue/LFRPS12-1420/transitions",
    ]);
  });

  it("refuses a transition the workflow does not allow, and says which ones it does", async () => {
    await expect(run("issue.transition", { key: "LFRPS12-1420", transition: "41" })).rejects.toThrow(
      /cannot take « 41 » from To Do/,
    );
    await expect(run("issue.transition", { key: "LFRPS12-1420", transition: "41" })).rejects.toBeInstanceOf(UserError);
    expect(writes()).toEqual([]);
  });

  it("moves an issue that has no local copy without touching any file", async () => {
    const out = await run("issue.transition", { key: "LFRPS12-1405", transition: "21" });
    expect(out).toMatchObject({ status: "Done", local: false });
  });

  it("refuses what is not an issue key, and a project not connected to Jira", async () => {
    await expect(run("issue.transitions", { key: "not a key" })).rejects.toThrow(/is not an issue key/);
    writeProject(project, { ...readProject(project), jiraOffline: true });
    await expect(run("issue.transitions", { key: "LFRPS12-1420" })).rejects.toThrow(/Jira is disconnected/);
    expect(sent).toEqual([]);
  });
});

describe("issue.people and issue.assign", () => {
  it("lists the assignable people matching a name, and who « me » is (kept for offline filters)", async () => {
    expect(knownMyself()).toBeNull();
    const all = await run("issue.people", { key: "LFRPS12-1420" });
    expect(all.me).toEqual({ accountId: "mock-account-1", name: "Mock Tester" });
    expect(all.people.map((p: { name: string }) => p.name)).toEqual([
      "Mock Tester",
      "Camille Martin",
      "Léa Bernard",
      "Hugo Petit",
    ]);
    const some = await run("issue.people", { key: "LFRPS12-1420", query: "cam" });
    expect(some.people).toEqual([{ accountId: "mock-account-2", name: "Camille Martin" }]);
    resetAuth();
    expect(knownMyself()?.accountId).toBe("mock-account-1");
  });

  it("assigns to someone, to me and to nobody, and test.md follows", async () => {
    const dry = await run("issue.assign", { key: "LFRPS12-1420", to: "mock-account-2", dryRun: true });
    expect(dry).toMatchObject({
      dryRun: true,
      from: { name: "Mock Tester" },
      assignee: { accountId: "mock-account-2" },
    });
    expect(writes()).toEqual([]);

    const to = await run("issue.assign", { key: "LFRPS12-1420", to: "mock-account-2" });
    expect(to).toMatchObject({ from: { name: "Mock Tester" }, assignee: { name: "Camille Martin" }, local: true });
    expect(readTest(project, "LFRPS12-1420").test).toMatchObject({
      assignee: "Camille Martin",
      assigneeId: "mock-account-2",
    });

    await run("issue.assign", { key: "LFRPS12-1420", to: "me" });
    expect(mockJiraTest("LFRPS12-1420")?.assignee).toBe("mock-account-1");

    const none = await run("issue.assign", { key: "LFRPS12-1420", to: null });
    expect(none.assignee).toBeNull();
    const t = readTest(project, "LFRPS12-1420").test;
    expect(t.assignee).toBeUndefined();
    expect(t.assigneeId).toBeUndefined();
    expect(md("LFRPS12-1420")).not.toMatch(/^assignee/m);
  });
});

describe("issue comments", () => {
  it("reads the thread oldest first, mentions in their text form, mine marked", async () => {
    const { comments } = await run("issue.comments", { key: "LFRPS12-1420" });
    expect(comments.map((c: { author: { name: string }; mine: boolean }) => [c.author.name, c.mine])).toEqual([
      ["Camille Martin", false],
      ["Mock Tester", true],
    ]);
    expect(comments[1].body).toBe("@[Camille Martin](mock-account-2) vu, je mets l’étape 3 à jour.");
  });

  it("posts a comment with its mentions as Jira mention nodes; a dry run posts nothing", async () => {
    const text = "@[Léa Bernard](mock-account-3) c'est corrigé.";
    const dry = await run("issue.comment", { key: "LFRPS12-1420", text, dryRun: true });
    expect(dry).toEqual({ dryRun: true, mentions: [{ accountId: "mock-account-3", name: "Léa Bernard" }] });
    expect(writes()).toEqual([]);
    const out = await run("issue.comment", { key: "LFRPS12-1420", text: `  ${text}\r\n` });
    expect(out.comment).toMatchObject({ body: text, mine: true, author: { name: "Mock Tester" } });
    const body = JSON.parse(writes()[0].body ?? "{}").body;
    expect(body.content[0].content[0]).toEqual({
      type: "mention",
      attrs: { id: "mock-account-3", text: "@Léa Bernard" },
    });
    expect(mockJiraTest("LFRPS12-1420")?.comments.at(-1)?.body).toBe(text);
  });

  it("refuses an empty comment before asking Jira", async () => {
    await expect(run("issue.comment", { key: "LFRPS12-1420", text: "  \n " })).rejects.toThrow(/The comment is empty/);
    expect(sent).toEqual([]);
  });

  it("passes Jira's refusal on as the user's error", async () => {
    mockJira.refuseComments = true;
    const e = await run("issue.comment", { key: "LFRPS12-1420", text: "Bonjour" }).catch((x) => x);
    expect(e).toBeInstanceOf(UserError);
    expect(e.message).toMatch(/Jira refused a comment on LFRPS12-1420: You do not have the permission to comment/);
    expect(e.fix).toMatch(/Jira admin/);
  });

  it("edits and deletes my comment, and is refused another's", async () => {
    const edited = await run("issue.editComment", { key: "LFRPS12-1420", id: "10102", text: "Corrigé." });
    expect(edited.comment).toMatchObject({ id: "10102", body: "Corrigé." });
    expect(await run("issue.editComment", { key: "LFRPS12-1420", id: "10102", text: "x", dryRun: true })).toEqual({
      dryRun: true,
    });
    await expect(run("issue.editComment", { key: "LFRPS12-1420", id: "10101", text: "Non" })).rejects.toThrow(
      /permission to edit this comment/,
    );
    expect(await run("issue.deleteComment", { key: "LFRPS12-1420", id: "10102", dryRun: true })).toEqual({
      dryRun: true,
      id: "10102",
    });
    expect(mockJiraTest("LFRPS12-1420")?.comments).toHaveLength(2);
    await run("issue.deleteComment", { key: "LFRPS12-1420", id: "10102" });
    expect(mockJiraTest("LFRPS12-1420")?.comments.map((c) => c.id)).toEqual(["10101"]);
  });
});
