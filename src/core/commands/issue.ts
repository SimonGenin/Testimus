import { z } from "zod";
import { type Ctx, command, projectOf, UserError } from "../command.ts";
import { MENTION } from "../lib/adf.ts";
import { getMyself, JiraRefused, withSignal } from "../lib/jira/http.ts";
import {
  addComment,
  assign,
  assignable,
  comments,
  deleteComment,
  editComment,
  issueState,
  reflect,
  transition,
  transitionsOf,
} from "../lib/jira/issue.ts";
import { ISSUE_KEY } from "../lib/jira/read.ts";
import { jiraKey } from "../lib/sync/connect.ts";

// ponytail: the Jira side of a test besides its content — status, assignee, comments. Every write goes to Jira at
// once, never through a push; each has a dryRun that says what it would do and writes nothing

const key = z.string().describe("Issue key of the test, e.g. LFRPS12-1420");
const dryRun = z.boolean().default(false).describe("Say what would be done in Jira, write nothing");
const category = z
  .enum(["new", "indeterminate", "done"])
  .describe("Jira's status category: new (to do), indeterminate (in progress, blocked…), done");
const person = z.object({
  accountId: z.string().describe("Jira account id"),
  name: z.string().describe("Display name"),
});
const transitionOut = z.object({
  id: z.string().describe("Transition id — what issue.transition takes"),
  name: z.string().describe("The transition's name in the workflow (Start testing, Done…)"),
  to: z.string().describe("The status it leads to"),
  category,
});
const commentOut = z.object({
  id: z.string().describe("Comment id"),
  author: person.nullable().describe("Who wrote it (null: an account Jira no longer shows)"),
  mine: z.boolean().describe("Written by the connected account — only those can be edited or deleted"),
  body: z.string().describe("The text; a mention is written @[Name](accountId)"),
  created: z.string().describe("When it was written (ISO)"),
  updated: z.string().describe("When it was last changed (ISO)"),
});
const commentText = z
  .string()
  .describe("The comment's text; a mention is written @[Name](accountId) and notifies that person in Jira");
const stateOut = {
  status: z.string().describe("The issue's status in Jira now"),
  category,
  assignee: person.nullable().describe("Who the issue is assigned to now (null: nobody)"),
  local: z.boolean().describe("The local copy (tests/<key>/test.md) was updated to match"),
};

const keyOf = (raw: string) => {
  const k = raw.trim().toUpperCase();
  if (!ISSUE_KEY.test(k)) throw new UserError(`"${raw}" is not an issue key.`, "Write it like LFRPS12-1420.");
  return k;
};

// ponytail: Jira's refusal (a permission of this issue) reaches the page as the user's error, with what to do
async function jira<T>(ctx: Ctx, work: () => Promise<T>): Promise<T> {
  jiraKey(projectOf(ctx));
  try {
    return await withSignal(ctx.signal, work);
  } catch (e) {
    if (e instanceof JiraRefused)
      throw new UserError(e.message, "Ask a Jira admin of the project for that permission, or do it in Jira.");
    throw e;
  }
}

async function follow(ctx: Ctx, k: string) {
  const s = await issueState(k);
  return { status: s.status, category: s.category, assignee: s.assignee, local: reflect(projectOf(ctx), k, s) };
}

function mustText(text: string): string {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (!t) throw new UserError("The comment is empty.", "Write something first.");
  return t;
}

export const commands = [
  command({
    name: "issue.transitions",
    summary:
      "Where a test's issue can move in Jira's workflow from its status now: each transition with the status it leads to. Asks Jira, writes nothing.",
    input: z.object({ key }),
    output: z.object({
      status: z.string().describe("The issue's status in Jira now"),
      category,
      transitions: z.array(transitionOut).describe("The transitions Jira allows from here, in Jira's order"),
    }),
    mutates: false,
    positional: ["key"],
    async run(ctx, input) {
      const k = keyOf(input.key);
      return jira(ctx, async () => {
        const [s, transitions] = await Promise.all([issueState(k), transitionsOf(k)]);
        return { status: s.status, category: s.category, transitions };
      });
    },
  }),

  command({
    name: "issue.transition",
    summary:
      "Move a test's issue in Jira's workflow now (not part of a push), then write the new status in tests/<key>/test.md. dryRun says from where to where, and writes nothing. undo names the transition that leads back, when there is one.",
    input: z.object({
      key,
      transition: z.string().describe("Transition id, as issue.transitions lists it"),
      dryRun,
    }),
    output: z.object({
      key: z.string().describe("The issue"),
      from: z.string().describe("Its status before"),
      to: z.string().describe("The status the transition leads to"),
      name: z.string().describe("The transition's name"),
      dryRun: z.boolean().describe("Nothing was written"),
      ...stateOut,
      undo: transitionOut.optional().describe("The transition back to the status before, when the workflow has one"),
    }),
    mutates: true,
    positional: ["key", "transition"],
    async run(ctx, input) {
      const k = keyOf(input.key);
      return jira(ctx, async () => {
        const [s, list] = await Promise.all([issueState(k), transitionsOf(k)]);
        const t = list.find((x) => x.id === input.transition || x.name === input.transition);
        if (!t)
          throw new UserError(
            `${k} cannot take « ${input.transition} » from ${s.status}.`,
            `Possible now: ${list.map((x) => `${x.name} → ${x.to} (${x.id})`).join(", ") || "none"}.`,
          );
        const plan = { key: k, from: s.status, to: t.to, name: t.name };
        if (input.dryRun)
          return { ...plan, dryRun: true, status: s.status, category: s.category, assignee: s.assignee, local: false };
        await transition(k, t.id);
        const now = await follow(ctx, k);
        const undo = (await transitionsOf(k)).find((x) => x.to === s.status);
        return { ...plan, dryRun: false, ...now, ...(undo ? { undo } : {}) };
      });
    },
  }),

  command({
    name: "issue.people",
    summary:
      "People a test's issue can be assigned to in Jira, matching a name (empty: the first ones Jira gives), and the connected account (me). Asks Jira, writes nothing.",
    input: z.object({
      key,
      query: z.string().default("").describe("Part of a name; empty lists the first ones"),
    }),
    output: z.object({
      me: person.describe("The connected Jira account"),
      people: z.array(person).describe("Assignable people matching the query, as Jira orders them"),
    }),
    mutates: false,
    positional: ["key"],
    async run(ctx, input) {
      const k = keyOf(input.key);
      return jira(ctx, async () => {
        const [me, people] = await Promise.all([getMyself(), assignable(k, input.query.trim())]);
        return { me: { accountId: me.accountId, name: me.displayName }, people };
      });
    },
  }),

  command({
    name: "issue.assign",
    summary:
      "Assign a test's issue in Jira now (not part of a push) — to an account id, to « me » (the connected account), or to nobody (null) — then write it in tests/<key>/test.md. dryRun says from whom to whom, and writes nothing.",
    input: z.object({
      key,
      to: z.string().nullable().describe("Account id, « me », or null to unassign"),
      dryRun,
    }),
    output: z.object({
      key: z.string().describe("The issue"),
      from: person.nullable().describe("Who it was assigned to before"),
      dryRun: z.boolean().describe("Nothing was written"),
      ...stateOut,
    }),
    mutates: true,
    positional: ["key", "to"],
    async run(ctx, input) {
      const k = keyOf(input.key);
      return jira(ctx, async () => {
        const before = await issueState(k);
        const to = input.to === "me" ? (await getMyself()).accountId : input.to || null;
        if (input.dryRun)
          return {
            key: k,
            from: before.assignee,
            dryRun: true,
            status: before.status,
            category: before.category,
            assignee: to
              ? { accountId: to, name: to === before.assignee?.accountId ? before.assignee.name : to }
              : null,
            local: false,
          };
        await assign(k, to);
        return { key: k, from: before.assignee, dryRun: false, ...(await follow(ctx, k)) };
      });
    },
  }),

  command({
    name: "issue.comments",
    summary:
      "The comments of a test's issue in Jira, oldest first (a mention reads @[Name](accountId)). Asks Jira, writes nothing.",
    input: z.object({ key }),
    output: z.object({ comments: z.array(commentOut).describe("Every comment, oldest first") }),
    mutates: false,
    positional: ["key"],
    async run(ctx, input) {
      const k = keyOf(input.key);
      return jira(ctx, async () => ({ comments: await comments(k) }));
    },
  }),

  command({
    name: "issue.comment",
    summary:
      "Post a comment on a test's issue in Jira now, as the connected account. A mention @[Name](accountId) notifies that person. dryRun shows what would be posted, and posts nothing.",
    input: z.object({ key, text: commentText, dryRun }),
    output: z.object({
      dryRun: z.boolean().describe("Nothing was posted"),
      mentions: z.array(person).describe("The people the comment mentions (Jira notifies them)"),
      comment: commentOut.optional().describe("The comment as Jira keeps it (absent on a dry run)"),
    }),
    mutates: true,
    positional: ["key"],
    async run(ctx, input) {
      const k = keyOf(input.key);
      const text = mustText(input.text);
      const mentions = [...text.matchAll(MENTION)].map((m) => ({ accountId: m[2], name: m[1] }));
      if (input.dryRun) return { dryRun: true, mentions };
      return jira(ctx, async () => ({ dryRun: false, mentions, comment: await addComment(k, text) }));
    },
  }),

  command({
    name: "issue.editComment",
    summary:
      "Change the text of one of your comments on a test's issue in Jira now. dryRun says which comment would change, and writes nothing.",
    input: z.object({
      key,
      id: z.string().describe("Comment id, as issue.comments lists it"),
      text: commentText,
      dryRun,
    }),
    output: z.object({
      dryRun: z.boolean().describe("Nothing was written"),
      comment: commentOut.optional().describe("The comment as Jira now keeps it (absent on a dry run)"),
    }),
    mutates: true,
    positional: ["key", "id"],
    async run(ctx, input) {
      const k = keyOf(input.key);
      const text = mustText(input.text);
      if (input.dryRun) return { dryRun: true };
      return jira(ctx, async () => ({ dryRun: false, comment: await editComment(k, input.id, text) }));
    },
  }),

  command({
    name: "issue.deleteComment",
    summary:
      "Delete one of your comments from a test's issue in Jira now — Jira keeps no copy. dryRun says which one, and deletes nothing.",
    input: z.object({ key, id: z.string().describe("Comment id, as issue.comments lists it"), dryRun }),
    output: z.object({
      dryRun: z.boolean().describe("Nothing was deleted"),
      id: z.string().describe("The comment"),
    }),
    mutates: true,
    positional: ["key", "id"],
    async run(ctx, input) {
      const k = keyOf(input.key);
      if (input.dryRun) return { dryRun: true, id: input.id };
      return jira(ctx, async () => {
        await deleteComment(k, input.id);
        return { dryRun: false, id: input.id };
      });
    },
  }),
];
