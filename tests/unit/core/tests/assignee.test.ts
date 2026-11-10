import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mcpAccess, readOnlyCommands } from "../../../../src/core/claude/access.ts";
import { draftPrompt } from "../../../../src/core/claude/comment.ts";
import "../../../../src/core/commands/index.ts";
import { env } from "../../../../src/core/env.ts";
import { adfToText, textToAdf } from "../../../../src/core/lib/adf.ts";
import { knownMyself } from "../../../../src/core/lib/jira/http.ts";
import { jiraOwned, patchFrontmatter } from "../../../../src/core/lib/review.ts";
import { forCompare } from "../../../../src/core/lib/sync/pull.ts";
import { keepReview } from "../../../../src/core/lib/test-edit.ts";
import { parseTest, serializeTest } from "../../../../src/core/lib/testfile.ts";
import { parseQuery } from "../../../../src/core/search/query.ts";
import { keepTest, type TestDoc } from "../../../../src/core/search/tests.ts";
import type { Test } from "../../../../src/core/types.ts";

const base: Test = {
  key: "LFRPS12-7",
  project: "LFRPS12",
  summary: "Sectionneur",
  folder: "/Lot",
  labels: [],
  status: "To Do",
  assignee: "Camille Martin",
  assigneeId: "acc-2",
  description: "",
  covers: [],
  preconditions: [],
  review: "draft",
  steps: [],
  extra: {},
};

describe("the assignee in test.md", () => {
  it("is written after the status and read back", () => {
    const md = serializeTest(base);
    expect(md).toMatch(/^status: To Do\nassignee: Camille Martin\nassignee_id: acc-2$/m);
    expect(parseTest(md).test).toMatchObject({ assignee: "Camille Martin", assigneeId: "acc-2" });
    expect(serializeTest({ ...base, assignee: undefined, assigneeId: undefined })).not.toMatch(/assignee/);
  });

  it("is Jira's: a save keeps disk's status and assignee, and a push never compares them", () => {
    const saved = keepReview(base, { ...base, status: "Old", assignee: "Someone", assigneeId: "x" });
    expect(saved).toMatchObject({ status: "To Do", assignee: "Camille Martin", assigneeId: "acc-2" });
    expect(forCompare(base)).toBe(forCompare({ ...base, status: "Done", assignee: undefined, assigneeId: undefined }));
  });

  it("follows Jira line by line, the rest of the file untouched", () => {
    const md = serializeTest(base);
    const to = patchFrontmatter(md, jiraOwned({ status: "Done", assignee: null, assigneeId: null }), "x", "y");
    expect(to).toBe(md.replace("status: To Do\nassignee: Camille Martin\nassignee_id: acc-2", "status: Done"));
    const back = patchFrontmatter(to, jiraOwned({ assignee: "Léa", assigneeId: "acc-3" }), "x", "y");
    expect(parseTest(back).test).toMatchObject({ status: "Done", assignee: "Léa", assigneeId: "acc-3" });
    expect(() => patchFrontmatter("no frontmatter", jiraOwned({ status: "Done" }), "lost", "again")).toThrow(/lost\./);
  });
});

describe("mentions in a comment's ADF", () => {
  it("a comment keeps who is mentioned, a description reads the plain name", () => {
    const text = "@[Camille Martin](acc-2) vu, et @[Léa](acc-3).\nSuite";
    const adf = textToAdf(text, { mentions: true });
    expect(adf.content[0].content).toEqual([
      { type: "mention", attrs: { id: "acc-2", text: "@Camille Martin" } },
      { type: "text", text: " vu, et " },
      { type: "mention", attrs: { id: "acc-3", text: "@Léa" } },
      { type: "text", text: "." },
    ]);
    expect(adfToText(adf, { mentions: true })).toBe(text);
    expect(adfToText(adf)).toBe("@Camille Martin vu, et @Léa.\nSuite");
    expect(textToAdf("@[A](b)").content[0].content).toEqual([{ type: "text", text: "@[A](b)" }]);
    expect(adfToText({ type: "mention", attrs: { text: "@Nobody" } }, { mentions: true })).toBe("@Nobody");
  });
});

const doc = (t: Partial<Test>): TestDoc =>
  ({ id: "T", fields: [], sync: "local", dirty: false, mtime: 0, test: { ...base, ...t } }) as unknown as TestDoc;
const keep = (raw: string, d: TestDoc, me: string | null = null) => keepTest(d, parseQuery(raw).filters, me);

describe("the assignee: filter", () => {
  it("reads me, none (nobody, unassigned) and part of a name, accents and case ignored", () => {
    expect(parseQuery('assignee:me who:nobody assigned:"Léa B"').filters.assignee).toEqual(["me", "none", "lea b"]);
    expect(parseQuery("assignee:unassigned").filters.assignee).toEqual(["none"]);
  });

  it("keeps the tests of that person, of nobody, or of me when me is known", () => {
    expect(keep("assignee:camille", doc({}))).toBe(true);
    expect(keep("assignee:CAMILLE", doc({ assignee: "Camille Märtin" }))).toBe(true);
    expect(keep("assignee:lea", doc({ assignee: "Léa Bernard" }))).toBe(true);
    expect(keep("assignee:lea", doc({}))).toBe(false);
    expect(keep("assignee:none", doc({ assignee: undefined }))).toBe(true);
    expect(keep("assignee:none", doc({}))).toBe(false);
    expect(keep("assignee:me", doc({}), "acc-2")).toBe(true);
    expect(keep("assignee:me", doc({}), "acc-9")).toBe(false);
    expect(keep("assignee:me", doc({}))).toBe(false);
    expect(keep("assignee:me assignee:none", doc({ assignee: undefined }), "acc-2")).toBe(true);
  });

  it("« me » is the account last read for these credentials, kept on disk", () => {
    expect(knownMyself()).toBeNull();
    const dir = join(env.homeDir(), ".atlassian");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "credentials.json"),
      JSON.stringify({ baseUrl: "https://x.atlassian.net", email: "me@x", token: "t" }),
    );
    mkdirSync(env.dataDir(), { recursive: true });
    const file = join(env.dataDir(), "jira-me.json");
    writeFileSync(file, JSON.stringify({ email: "other@x", accountId: "acc-1", displayName: "Other" }));
    expect(knownMyself()).toBeNull();
    writeFileSync(file, JSON.stringify({ email: "me@x", accountId: "acc-2", displayName: "Me" }));
    expect(knownMyself()).toEqual({ accountId: "acc-2", displayName: "Me", emailAddress: undefined });
  });
});

describe("what a Claude run may do with the issue", () => {
  it("reads the thread, the people and the workflow; never moves, assigns or comments", async () => {
    expect(readOnlyCommands()).toEqual(expect.arrayContaining(["issue.comments", "issue.people", "issue.transitions"]));
    const writes = ["transition", "assign", "comment", "editComment", "deleteComment"].map(
      (v) => `mcp__testimus__issue_${v}`,
    );
    for (const k of ["chat", "action", "run", "generate"] as const) {
      const a = mcpAccess(k);
      for (const n of writes) expect(a.deny, `${k} ${n}`).toContain(n);
    }
    expect(mcpAccess("chat").allow).toContain("mcp__testimus__issue_comments");
  });

  it("the draft prompt names the skill, the key and the ask; how to read the thread and mention someone is the skill's", () => {
    const p = draftPrompt("LFRPS12-7", "Réponds à Léa", "fr", ["", "Context: x"]);
    expect(p).toMatch(/^Use the draft-comment skill to draft a comment for the Jira issue LFRPS12-7/);
    expect(p).toContain("Write in the language of the thread (the project's is French).");
    expect(p).toContain("\n\nContext: x\n\nWhat the comment should say: Réponds à Léa\n");
    expect(draftPrompt("LFRPS12-7", "  ", "fr")).toContain("What the comment should say: answer the thread.");
    expect(p).not.toContain("accountId");
    const skill = readFileSync(
      join(import.meta.dirname, "../../../../templates/project/.claude/skills/draft-comment/SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("`@[Their Name](accountId)`, exactly that form");
    expect(skill).toContain("`issue_people`");
    expect(skill).toContain("`issue_comments`");
  });
});
