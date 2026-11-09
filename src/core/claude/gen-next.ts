import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../command.ts";
import { env } from "../env.ts";
import { type Proposal, proposeAction } from "../lib/actions.ts";
import { readProject } from "../lib/project.ts";
import { readCheck, readTest, testDir, testExists } from "../lib/store.ts";
import { frontmatterOf } from "../lib/testfile.ts";
import { ACTION_EFFORTS, ACTION_MODELS, type Effort, type Finding } from "../types.ts";
import { type ProposedBy, proposeGenActions } from "./gen-actions.ts";
import { languageName } from "./gen-prompt.ts";
import { byCategory, type Skipped, type SkippedGroup, STOPPED } from "./gen-reply.ts";
import { readLedger, type Suggestion, setSuggestions } from "./ledger.ts";
import type { PromptTemplate } from "./prompt.ts";
import { newRunId, runClaude } from "./run.ts";

// ponytail: after a generation Claude itself says what is next — it reads what was written and what the check found,
// and answers with concrete fixes per test (proposed as Claude actions, deduplicated like any) and a few requests that
// fit this generation (its Suggestions, kept in its ledger). One cheap run, no tool needed: everything is in the prompt.
// When it fails, Claude is away or the generation was cancelled, the core's own rules propose instead (gen-actions.ts);
// a test with findings Claude left without a fix gets the core's too, and the tests not written always do

export const NEXT_MARKER = "Testimus after a generation";
export const NEXT_TAG = "gen-next";
export const NEXT_RUN: { model: string; effort: Effort } = { model: "sonnet", effort: "low" };

export type NextFix = Pick<Proposal, "title" | "problem" | "why" | "plan"> & {
  test: string;
  model?: (typeof ACTION_MODELS)[number];
  effort?: (typeof ACTION_EFFORTS)[number];
};
export type NextReply = { found: boolean; fixes: NextFix[]; suggestions: Suggestion[] };

export type TestBrief = { id: string; summary: string; steps: number; findings: Finding[]; text?: string };

const MAX_TEST = 9000;
const MAX_ALL = 60000;
const MAX_FIXES = 3;
const MAX_SUGGESTIONS = 5;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const fixable = (f: Finding) => f.severity !== "info";

const findingLine = (f: Finding) =>
  `- ${f.severity}${f.step ? `, step ${f.step}` : ""}, ${f.kind}: ${f.message}${f.sources.length ? ` [${f.sources.join("; ")}]` : ""}`;

function testLines(t: TestBrief): string[] {
  const found = t.findings.filter(fixable);
  const head = `## ${t.id} — « ${t.summary} » (${t.steps} step${t.steps === 1 ? "" : "s"})`;
  if (!found.length) return [head, "No finding.", ...(t.text ? ["```markdown", t.text, "```"] : []), ""];
  return [head, "Findings:", ...found.map(findingLine), ...(t.text ? ["```markdown", t.text, "```"] : []), ""];
}

export function nextText(o: {
  generation: string;
  request: string;
  language: string;
  tests: TestBrief[];
  skipped: SkippedGroup[];
  revised?: boolean;
}): string {
  const lines = [
    `${NEXT_MARKER} ${o.generation}: read the tests it ${o.revised ? "changed" : "wrote"} and what the check found, then say what should come next.`,
    "Everything you need is below: call no tool and change nothing.",
    "",
    `The request: ${o.request.trim() || "(documents only, no words)"}`,
    `Language of the tests: ${languageName(o.language)}.`,
    "",
    `Tests ${o.revised ? "changed" : "of the generation"} (${o.tests.length}):`,
    "",
    ...o.tests.flatMap(testLines),
  ];
  if (o.skipped.length)
    lines.push(
      "Items no test was written for:",
      ...o.skipped.map((g) => `- ${g.category}: ${g.items.map((s) => s.item).join("; ")}`),
      "",
    );
  lines.push(
    `Reply with one fenced ${NEXT_TAG} block and nothing after it:`,
    `\`\`\`${NEXT_TAG}`,
    '{ "fixes": [{ "test": "<test id>", "title": "…", "problem": "…", "why": "…", "plan": ["…"], "model": "haiku|sonnet|opus", "effort": "low|medium|high|xhigh" }],',
    '  "suggestions": [{ "label": "…", "prompt": "…", "scope": "change|add" }] }',
    "```",
    `fixes: for each test with findings, 1 to ${MAX_FIXES} concrete changes that answer them. title: the change itself, a verb`,
    "first, at most 60 characters, naming what changes and where (« Add EXI_MOP_CDC_365_1640 to steps 6 and 10 »,",
    "« Quote §5.6.6 for the result of step 4 »), never « Fix the errors »; problem: the findings it answers, in one or",
    "two sentences; why: one sentence on why it can be fixed from the documents; plan: 2 to 4 short steps.",
    "model and effort: what the fix needs — haiku (a mechanical change), sonnet (ordinary test edits) or opus (reading",
    "documents, judging); low (one obvious change), medium, high (a real search) or xhigh (long, delicate).",
    "A finding only the team can settle (a choice, a conflict between documents) gets no fix.",
    `suggestions: 3 to ${MAX_SUGGESTIONS} requests the user could ask next about these tests as a whole — what this generation`,
    "lacks or could do better, in the documents' terms (« Add the cases where the TK is faulty », « Merge the two tests",
    "on opening the menu »), never a generic one. label: at most 32 characters, a verb first; prompt: one or two",
    'sentences telling Claude what to do; scope "add" for new tests under this generation, "change" for the tests above.',
    "Write titles, labels and prompts in English.",
    "",
  );
  return lines.join("\n");
}

export const prompts: PromptTemplate[] = [
  {
    id: "gen-next",
    name: "What is next after a generation",
    group: "Generation",
    usedBy: [
      "Generate: the fixes on each test's card and the Suggestions of Ask for changes",
      "gen.tests, gen.revise (at their end)",
    ],
    text: () =>
      nextText({
        generation: "{generation}",
        request: "{request}",
        language: "{language}",
        tests: [
          {
            id: "{test}",
            summary: "{summary}",
            steps: 0,
            findings: [{ kind: "other", severity: "error", message: "{finding}", sources: [], step: 1 }],
            text: "{test.md, when it has findings}",
          },
        ],
        skipped: [{ category: "{category}", items: [{ item: "{item not written}", category: "", why: "" }] }],
      }).replace("(0 steps)", "({n} steps)"),
  },
];

const text = (o: Record<string, unknown>, k: string, n: number) =>
  typeof o[k] === "string" ? clip((o[k] as string).replace(/\s+/g, " ").trim(), n) : "";

// ponytail: the last fenced gen-next block; what is not a fix or a suggestion is dropped, never the whole reply
export function parseNext(reply: string): NextReply {
  const blocks = [...reply.matchAll(/```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)```/g)].filter((b) => b[1] === NEXT_TAG);
  for (const b of blocks.reverse()) {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(b[2]) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    const fixes: NextFix[] = [];
    for (const u of Array.isArray(o.fixes) ? o.fixes : []) {
      if (!u || typeof u !== "object") continue;
      const x = u as Record<string, unknown>;
      const plan = (Array.isArray(x.plan) ? x.plan : [])
        .filter((s): s is string => typeof s === "string" && !!s.trim())
        .map((s) => clip(s.trim(), 300))
        .slice(0, 8);
      const fix = {
        test: text(x, "test", 40),
        title: text(x, "title", 80),
        problem: text(x, "problem", 2000),
        why: text(x, "why", 2000),
        plan,
      };
      if (!fix.test || fix.title.length < 3 || !fix.problem || !plan.length) continue;
      const model = ACTION_MODELS.find((m) => m === x.model);
      const effort = ACTION_EFFORTS.find((e) => e === x.effort);
      fixes.push({ ...fix, why: fix.why || "The findings name the passages that settle them.", model, effort });
    }
    const suggestions: Suggestion[] = [];
    for (const u of Array.isArray(o.suggestions) ? o.suggestions : []) {
      if (!u || typeof u !== "object") continue;
      const x = u as Record<string, unknown>;
      const s = { label: text(x, "label", 40), prompt: text(x, "prompt", 600) };
      if (!s.label || !s.prompt || suggestions.some((k) => k.label === s.label)) continue;
      suggestions.push(x.scope === "add" ? { ...s, scope: "add" } : s);
    }
    return { found: true, fixes, suggestions: suggestions.slice(0, MAX_SUGGESTIONS) };
  }
  return { found: false, fixes: [], suggestions: [] };
}

function brief(project: string, id: string): TestBrief {
  const { test } = readTest(project, id);
  const md = readFileSync(join(testDir(project, id), "test.md"), "utf8");
  return {
    id,
    summary: test.summary.trim() || id,
    steps: test.steps.length,
    findings: readCheck(project, id)?.findings ?? [],
    text: clip((frontmatterOf(md)?.rest ?? md).trim(), MAX_TEST),
  };
}

// ponytail: the tests with findings are sent whole first; the others too while the prompt stays under its budget, then
// by their summary only — a large generation never makes a costly run
function briefs(project: string, ids: string[]): TestBrief[] {
  const all = ids.filter((id) => testExists(project, id)).map((id) => brief(project, id));
  const order = [...all.filter((t) => t.findings.some(fixable)), ...all.filter((t) => !t.findings.some(fixable))];
  let used = 0;
  const sent = new Map(
    order.map((t) => {
      used += t.text?.length ?? 0;
      return [t.id, used <= MAX_ALL ? t : { ...t, text: undefined }];
    }),
  );
  return all.map((t) => sent.get(t.id) ?? t);
}

const money = (usd?: number) => (usd === undefined ? "cost unknown" : `$${usd.toFixed(usd < 0.1 ? 3 : 2)}`);
const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type NextInput = {
  /** the tests this run wrote or changed: the fixes are proposed on them */
  tests: string[];
  skipped: Skipped[];
  by: ProposedBy;
  /** false when the generation failed or was cancelled: the core's rules propose, Claude is not asked */
  ask: boolean;
  revised?: boolean;
};

export async function proposeNext(ctx: Ctx, project: string, generation: string, o: NextInput): Promise<NextReply> {
  const fallback = (tests: string[]) =>
    proposeGenActions(project, generation, { tests, skipped: o.skipped, by: o.by }, ctx.log);
  const present = o.tests.filter((id) => testExists(project, id));
  if (!o.ask || !present.length || ctx.signal.aborted) {
    fallback(present);
    return { found: false, fixes: [], suggestions: [] };
  }
  ctx.step?.("next");
  ctx.progress({ message: "Claude proposes what is next" });
  const ledger = readLedger(project, generation);
  const tests = briefs(project, present);
  const runId = newRunId();
  const r = await runClaude({
    kind: "triage",
    project,
    prompt: nextText({
      generation,
      request: ledger?.input?.request ?? "",
      language: readProject(project).language,
      tests,
      skipped: byCategory(o.skipped.filter((s) => s.category !== STOPPED)),
      revised: o.revised,
    }),
    model: NEXT_RUN.model,
    effort: NEXT_RUN.effort,
    runId,
    label: "propose next",
    title: "what is next",
    ...(ctx.jobId ? { jobId: ctx.jobId } : {}),
    signal: ctx.signal,
    onEvent: (e) => ctx.claude(e),
  }).catch((e: unknown) => ({ ok: false, summary: e instanceof Error ? e.message : String(e), costUsd: undefined }));
  const reply = r.ok ? parseNext(r.summary) : { found: false, fixes: [], suggestions: [] };
  const cost = `${NEXT_RUN.model}, ${NEXT_RUN.effort} effort: ${money(r.costUsd)}`;
  if (!reply.found) {
    ctx.log(
      "warn",
      `Claude did not say what is next (${r.ok ? "no gen-next block in its reply" : clip(r.summary, 200)}; ${cost}): the fixes are the core's own.`,
    );
    fallback(present);
    return reply;
  }
  const withFindings = new Set(tests.filter((t) => t.findings.some(fixable)).map((t) => t.id));
  const proposedBy = {
    run: "after generation",
    model: NEXT_RUN.model,
    effort: NEXT_RUN.effort,
    at: env.now().toISOString(),
    runId,
  };
  const per = new Map<string, number>();
  let proposed = 0;
  for (const f of reply.fixes) {
    const n = per.get(f.test) ?? 0;
    if (!withFindings.has(f.test) || n >= MAX_FIXES) continue;
    try {
      proposeAction(project, {
        title: f.title,
        scope: { kind: "test", testId: f.test },
        where: `test:${f.test}`,
        problem: f.problem,
        why: f.why,
        plan: f.plan,
        proposedBy,
        ...(f.model && f.effort ? { suggest: { model: f.model, effort: f.effort } } : {}),
      });
      per.set(f.test, n + 1);
      proposed++;
    } catch (e) {
      ctx.log("warn", `No Claude action for « ${f.title} »: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (reply.suggestions.length) setSuggestions(project, generation, reply.suggestions);
  ctx.log(
    "info",
    `Claude proposed ${counted(proposed, "fix", "fixes")} and ${counted(reply.suggestions.length, "suggestion", "suggestions")} (${cost}).`,
  );
  fallback(present.filter((id) => withFindings.has(id) && !per.has(id)));
  return reply;
}
