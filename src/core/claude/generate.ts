import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../command.ts";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { loadCorpus, runMechanical } from "../lib/check.ts";
import { columnGuidance } from "../lib/columns.ts";
import { readDocMd } from "../lib/docs.ts";
import { fieldOrder, readProject, readXray, writeJson } from "../lib/project.ts";
import { listLocalTests, markGenerated, readTest, removeTest, testExists, writeTest } from "../lib/store.ts";
import { anchorsOf } from "../rag/convert.ts";
import { awaitsReview, type ClaudeEvent, type Diagnosis, type Effort, type Tokens } from "../types.ts";
import { proposeLines } from "./actions.ts";
import { checkTests, promoteChecked } from "./check.ts";
import { ledgerOf } from "./ledger.ts";
import { contextLines, readContexts } from "./prompt.ts";
import { newRunId, type RunResult, runClaude } from "./run.ts";
import { absorbRun, markLeft, readRun } from "./snapshot.ts";

export const GEN_MARKER = "Use the generate-tests skill";
export const REPORT_TAG = "gen-report";
export const PLAN_TAG = "test-plan";
export const PLAN_MARKER = "use the plan-tests skill";
// ponytail: past this many requirements in scope, one run reads the whole scope once and writes every test from
// memory (2026-11-03: 20 tests, one of 40 steps, 172 findings); a plan, then one run per test, re-reads each part
export const PLAN_ABOVE = 15;
export const PLAN_MAX = 30;

const LANGUAGES: Record<string, string> = {
  fr: "French",
  en: "English",
  de: "German",
  es: "Spanish",
  it: "Italian",
  nl: "Dutch",
  pt: "Portuguese",
};

export const languageName = (code: string) => LANGUAGES[code.toLowerCase()] ?? code;

export type GenInput = {
  request: string;
  requirements?: string[];
  sections?: string[];
  docs?: string[];
  folder?: string;
  model?: string;
  effort?: Effort;
  check?: boolean;
  contexts?: string[];
  note?: string;
  discard?: boolean;
};

export type Uncovered = { item: string; why: string };
export type GenReport = {
  found: boolean;
  tests: string[];
  covered: string[];
  uncovered: Uncovered[];
  consulted: string[];
};

export type PlannedTest = { summary: string; technique: string; requirements: string[]; sections: string[] };
export type TestPlan = { found: boolean; tests: PlannedTest[]; uncovered: Uncovered[] };

export type GenCheck = { id: string; ok: boolean; review: string; errors: number; warnings: number };

export type GenResult = {
  runId: string;
  ok: boolean;
  summary: string;
  tests: string[];
  checks: GenCheck[];
  changed: string[];
  discarded: string[];
  uncovered: Uncovered[];
  reportFound: boolean;
  consulted: number;
  planned: number;
  costUsd?: number;
  tokens?: Tokens;
  durationMs: number;
  diagnosis?: Diagnosis;
};

const clean = (xs: string[] | undefined) => [...new Set((xs ?? []).map((x) => x.trim()).filter(Boolean))];
const isSection = (s: string) => /^[^#\s]+#\S.*$/.test(s);

export function scopeRequirements(project: string, i: GenInput): string[] {
  const docs = clean(i.docs).filter((d) => existsSync(join(project, "docs", d, "doc.md")));
  return [
    ...new Set([...clean(i.requirements), ...docs.flatMap((d) => anchorsOf(readDocMd(project, d)).requirements)]),
  ];
}

export type PlanPart = { n: number; of: number; request: string };

export function checkGenInput(i: GenInput, project?: string): void {
  if (!i.request.trim() && !clean(i.requirements).length && !clean(i.sections).length && !clean(i.docs).length)
    throw new UserError(
      "Nothing to generate: the request, the requirements, the documents and the sections are all empty.",
      "Describe the feature in words, or give documents, requirement ids or document sections (DOC#§5.6.6).",
    );
  const missing = project ? clean(i.docs).filter((d) => !existsSync(join(project, "docs", d, "doc.md"))) : [];
  if (missing.length)
    throw new UserError(`No document ${missing.join(", ")} in this project.`, "testimus docs list shows them.");
  const bad = clean(i.sections).filter((s) => !isSection(s));
  if (bad.length)
    throw new UserError(
      `Not a document section: ${bad.join(", ")}.`,
      "Write a section as docId#§x.y, e.g. SOSIE_211_D401-1_3#§5.6.6.",
    );
}

export function genPrompt(
  project: string,
  i: GenInput,
  contextIds: string[] = [],
  runId?: string,
  part?: PlanPart,
): string {
  const p = readProject(project);
  const reqs = clean(i.requirements);
  const sections = clean(i.sections);
  const docs = clean(i.docs);
  const size = part ? 0 : scopeRequirements(project, i).length;
  const lines = [
    `${GEN_MARKER} to write Xray manual tests for the request below, in this project folder.`,
    "",
    `Request: ${i.request.trim() || "(none in words — cover the documents, requirements and sections below)"}`,
  ];
  if (part)
    lines.push(
      `This is test ${part.n} of ${part.of} of a plan${part.request ? ` for: ${part.request}` : ""}. Write exactly this one test; the other tests of the plan are written by other runs.`,
    );
  if (size > PLAN_ABOVE)
    lines.push(
      `The scope holds ${size} requirements. When covering it takes more than 3 tests, ${PLAN_MARKER} instead: write no test, and end your reply with its ${PLAN_TAG} block instead of the report block below.`,
    );
  if (reqs.length)
    lines.push(`Requirements to cover, each by at least one step (read each one first): ${reqs.join(", ")}`);
  if (docs.length)
    lines.push(
      `Documents in scope, each in full (${i.request.trim() ? "find in them what the request is about" : "cover the behaviors they specify"}): ${docs.join(", ")}`,
    );
  if (sections.length)
    lines.push(`Document sections in scope (read each with rag_passage and in doc.md): ${sections.join(", ")}`);
  lines.push(...columnGuidance(project, docs.length || sections.length ? { docs, sections } : undefined), "");
  lines.push(
    i.folder?.trim()
      ? `Target Xray folder: ${i.folder.trim()}`
      : `Target Xray folder: none given — pick the closest of project.json folders (${p.folders.join(", ") || "none"}), else /`,
    `Language of the tests: ${languageName(p.language)} (project.json language "${p.language}").`,
    "",
    "Write only new tests: one folder tests/local-<8 hex>/test.md per test (tests_create allocates it), with review: draft.",
    "Pictures matter as much as sources: a step that acts on or looks at a screen, a menu, a symbol or a colour gets the document's picture of it with tests_addImage (skill section 3, Figures) — when the document has one.",
    "Never modify, rename or delete an existing test. Never call a tool that writes to Jira.",
  );
  lines.push(...contextLines(project, readContexts(project, contextIds), i.note));
  if (runId)
    lines.push(
      ...proposeLines(
        runId,
        'a document section you could not cover because its text is a picture or a table the conversion lost — { kind: "doc", docId }, where: "doc:<docId>"',
      ),
    );
  lines.push(
    "",
    `When you finish, end your reply with the report block of the skill (section 4), exactly this shape:`,
    "```" + REPORT_TAG,
    '{"tests": ["local-…"], "covered": ["<requirement id or behavior>"], "uncovered": [{"item": "<requirement id or behavior>", "why": "<reason>"}], "consulted": ["<docId#anchor you read>"]}',
    "```",
    "",
  );
  return lines.join("\n");
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : [];
}

function asUncovered(v: unknown): Uncovered[] {
  if (!Array.isArray(v)) return [];
  const out: Uncovered[] = [];
  for (const u of v) {
    if (typeof u === "string" && u.trim()) out.push({ item: u.trim(), why: "" });
    else if (u && typeof u === "object") {
      const o = u as Record<string, unknown>;
      const item = typeof o.item === "string" ? o.item.trim() : "";
      if (item) out.push({ item, why: typeof o.why === "string" ? o.why.trim() : "" });
    }
  }
  return out;
}

// ponytail: the report is the last fenced block tagged gen-report; a plain ```json block that holds
// "uncovered" is accepted too, because a model sometimes drops the tag — anything else is no report
export function parseGenReport(text: string): GenReport {
  const blocks = [...text.matchAll(/```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)```/g)];
  const tagged = blocks.filter((b) => b[1] === REPORT_TAG);
  const loose = blocks.filter((b) => b[1] !== REPORT_TAG && b[2].includes('"uncovered"'));
  for (const b of [...tagged.reverse(), ...loose.reverse()]) {
    try {
      const o = JSON.parse(b[2]) as Record<string, unknown>;
      if (!o || typeof o !== "object" || Array.isArray(o)) continue;
      return {
        found: true,
        tests: asStrings(o.tests),
        covered: asStrings(o.covered),
        uncovered: asUncovered(o.uncovered),
        consulted: asStrings(o.consulted),
      };
    } catch {}
  }
  return { found: false, tests: [], covered: [], uncovered: [], consulted: [] };
}

// ponytail: the plan is the last fenced block tagged test-plan; a planned test needs a summary, and keeps only the
// sections written docId#anchor
export function parsePlan(text: string): TestPlan {
  const blocks = [...text.matchAll(/```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)```/g)].filter((b) => b[1] === PLAN_TAG);
  for (const b of blocks.reverse()) {
    try {
      const o = JSON.parse(b[2]) as Record<string, unknown>;
      if (!o || typeof o !== "object" || !Array.isArray(o.tests)) continue;
      const tests: PlannedTest[] = [];
      for (const t of o.tests as unknown[]) {
        if (!t || typeof t !== "object") continue;
        const x = t as Record<string, unknown>;
        const summary = typeof x.summary === "string" ? x.summary.trim() : "";
        if (!summary) continue;
        tests.push({
          summary,
          technique: typeof x.technique === "string" ? x.technique.trim() : "",
          requirements: asStrings(x.requirements),
          sections: asStrings(x.sections).filter(isSection),
        });
      }
      if (tests.length) return { found: true, tests, uncovered: asUncovered(o.uncovered) };
    } catch {}
  }
  return { found: false, tests: [], uncovered: [] };
}

export function plannedInput(i: GenInput, t: PlannedTest): GenInput {
  return {
    ...i,
    request: t.technique ? `${t.summary} (${t.technique})` : t.summary,
    requirements: t.requirements,
    sections: t.sections,
    docs: t.sections.length ? [] : i.docs,
  };
}

export type ToolStep = { kind: "read" } | { kind: "write"; testId: string } | null;

const TEST_PATH = /tests[\\/]+(local-[0-9a-f]{8})[\\/]+test\.md/i;

export function toolStep(e: ClaudeEvent): ToolStep {
  if (e.type !== "tool") return null;
  if (/(^|_)rag_(search|passage|figure|mentions|related)$/.test(e.name)) return { kind: "read" };
  if (/^(Write|Edit|MultiEdit)$/.test(e.name)) {
    const id = e.input.match(TEST_PATH)?.[1];
    return id ? { kind: "write", testId: id.toLowerCase() } : null;
  }
  if (/(^|_)tests_(save|edit)$/.test(e.name)) {
    const id = e.input.match(/"id"\s*:\s*"(local-[0-9a-f]{8})"/i)?.[1];
    return id ? { kind: "write", testId: id.toLowerCase() } : null;
  }
  if ((e.name === "Read" || e.name === "Grep") && /docs[\\/]+[^\\/]+[\\/]+doc\.md/.test(e.input))
    return { kind: "read" };
  return null;
}

export function stampTest(project: string, id: string, generatedBy: string, folder?: string): void {
  const { test } = readTest(project, id);
  const jira = readProject(project).jiraProject;
  const want = {
    ...test,
    generatedBy,
    review: "draft" as const,
    project: test.project || jira,
    folder: folder && (!test.folder || test.folder === "/") ? folder : test.folder || "/",
  };
  if (
    want.generatedBy === test.generatedBy &&
    test.review === "draft" &&
    want.project === test.project &&
    want.folder === test.folder
  )
    return;
  writeTest(project, id, want, fieldOrder(readXray(project)));
}

// ponytail: what a new generation replaces — Claude's tests still waiting in review, never the ones pushed to Jira
export const discardable = (project: string) =>
  listLocalTests(project)
    .filter((t) => awaitsReview(t) && !t.key)
    .map((t) => t.id);

type GenRun = { run: RunResult; tests: string[]; changed: string[]; report: GenReport };

async function genRun(
  ctx: Ctx,
  project: string,
  input: GenInput,
  o: { runId: string; by: string; contexts: string[]; prompt: string; label: string },
): Promise<GenRun> {
  const p = readProject(project);
  let reads = 0;
  const written: string[] = [];
  const texts: string[] = [];
  const run = await runClaude({
    project,
    runId: o.runId,
    label: o.label,
    prompt: o.prompt,
    model: input.model || p.claude.model,
    effort: input.effort || p.claude.effort,
    kind: "generate",
    scope: { kind: "project" },
    contexts: o.contexts,
    signal: ctx.signal,
    onEvent: (e) => {
      ctx.claude(e);
      if (e.type === "text") texts.push(e.text);
      const s = toolStep(e);
      if (s?.kind === "read") ctx.progress({ message: `Reading passages (${++reads})` });
      if (s?.kind === "write" && !written.includes(s.testId)) {
        written.push(s.testId);
        ctx.progress({ message: `Writing ${s.testId} (${written.length})` });
      }
    },
  });
  const before = readRun(project, run.runId).before;
  // ponytail: a test is this generation's only when it did not exist before the run, a call of this run
  // wrote it, and no other generation stamped it — a test made by hand meanwhile is never claimed
  const tests = run.changedTests.filter(
    (id) =>
      before[id] === null &&
      run.written.includes(id) &&
      testExists(project, id) &&
      [undefined, "", o.by].includes(readTest(project, id).test.generatedBy),
  );
  const changed = run.changedTests.filter((id) => before[id] !== null && run.written.includes(id));
  const report = parseGenReport(run.summary);
  return { run, tests, changed, report: report.found ? report : parseGenReport(texts.join("")) };
}

const union = (xs: string[][]) => [...new Set(xs.flat())];

export async function generateTests(project: string, input: GenInput, ctx: Ctx): Promise<GenResult> {
  checkGenInput(input, project);
  const p = readProject(project);
  const discarded = input.discard ? discardable(project) : [];
  for (const id of discarded) removeTest(project, id);
  if (discarded.length)
    ctx.log("info", `Deleted ${discarded.length} test(s) not validated yet: ${discarded.join(", ")}.`);
  const contexts = input.contexts ?? p.claude.contexts;
  ctx.progress({ message: "Reading passages" });
  const runId = newRunId();
  const by = ctx.jobId ?? runId;
  const first = await genRun(ctx, project, input, {
    runId,
    by,
    contexts,
    prompt: genPrompt(project, input, contexts, runId),
    label: "generate",
  });
  const runs = [first];
  const plan = first.tests.length || !first.run.ok ? null : parsePlan(first.run.summary);
  const todo = plan?.found ? plan.tests.slice(0, PLAN_MAX) : [];
  if (plan && plan.tests.length > todo.length)
    ctx.log("warn", `The plan has ${plan.tests.length} tests; only the first ${PLAN_MAX} are written.`);
  if (todo.length) ctx.log("info", `Plan: ${todo.length} test(s), written one run each.`);
  for (const [k, t] of todo.entries()) {
    if (ctx.signal.aborted) break;
    ctx.progress({ message: `Test ${k + 1} of ${todo.length}: ${t.summary}`, done: k, total: todo.length });
    const id = newRunId();
    const part = plannedInput(input, t);
    const r = await genRun(ctx, project, part, {
      runId: id,
      by,
      contexts,
      prompt: genPrompt(project, part, contexts, id, { n: k + 1, of: todo.length, request: input.request.trim() }),
      label: `generate ${k + 1}/${todo.length}`,
    });
    absorbRun(project, runId, id);
    runs.push(r);
    if (!r.run.ok) break;
  }
  const planned = runs.slice(1);
  const tests = union(runs.map((r) => r.tests));
  const changed = union(runs.map((r) => r.changed));
  // ponytail: the evidence ledger is on disk before the new tests are checked, so their first check already
  // sees what the generation never opened (related-unread); the full report replaces it below
  const ledger = ledgerOf(
    project,
    runs.flatMap((r) => r.run.calls),
  );
  const ledgerFile = join(project, ".testimus", "gen", `${by}.json`);
  writeJson(ledgerFile, {
    at: env.now().toISOString(),
    input,
    runId,
    tests,
    consulted: ledger.consulted,
    searched: ledger.searched,
  });
  for (const id of tests) stampTest(project, id, by, input.folder?.trim() || undefined);
  const checks: GenCheck[] = [];
  if (tests.length && input.check !== false && !ctx.signal.aborted) {
    ctx.progress({ message: `Checking ${tests.length} new test(s)` });
    for (const r of await checkTests(ctx, project, tests, true)) {
      const n = (s: string) => r.check.findings.filter((f) => f.severity === s).length;
      checks.push({
        id: r.id,
        ok: r.ok,
        review: promoteChecked(ctx, project, r),
        errors: n("error"),
        warnings: n("warning"),
      });
    }
  } else if (tests.length) {
    const corpus = loadCorpus(project);
    for (const id of tests) runMechanical(project, id, corpus);
  }
  markLeft(project, runId, tests);
  for (const id of tests) markGenerated(project, id);
  for (const id of changed) ctx.log("warn", `The generation changed the existing test ${id} — revert with ${runId}.`);
  const reports = planned.length ? planned.map((r) => r.report) : [first.report];
  const reportFound = reports.every((r) => r.found);
  const failed = runs.find((r) => !r.run.ok)?.run;
  if (!reportFound && !failed)
    ctx.log("warn", "The generation reply has no gen-report block: uncovered items unknown.");
  if (failed) ctx.log("error", failed.summary);
  const sum = (f: (r: RunResult) => number | undefined) =>
    runs.some((r) => f(r.run) !== undefined) ? runs.reduce((a, r) => a + (f(r.run) ?? 0), 0) : undefined;
  const tokensIn = sum((r) => r.tokens?.input);
  const output = sum((r) => r.tokens?.output);
  const costUsd = sum((r) => r.costUsd);
  const diagnosis = failed?.diagnosis;
  const result: GenResult = {
    runId,
    ok: !failed,
    summary: planned.length
      ? [`Plan: ${todo.length} test(s).`, ...planned.map((r) => r.run.summary)].join("\n\n")
      : first.run.summary,
    tests,
    checks,
    changed,
    discarded,
    uncovered: [...(plan?.uncovered ?? []), ...reports.flatMap((r) => r.uncovered)],
    reportFound,
    consulted: ledger.consulted.length,
    planned: planned.length,
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(tokensIn !== undefined && output !== undefined ? { tokens: { input: tokensIn, output } } : {}),
    durationMs: runs.reduce((a, r) => a + r.run.durationMs, 0),
    ...(diagnosis ? { diagnosis } : {}),
  };
  writeJson(ledgerFile, {
    at: env.now().toISOString(),
    input,
    ...result,
    covered: union(reports.map((r) => r.covered)),
    consulted: ledger.consulted,
    searched: ledger.searched,
    reportedConsulted: union(reports.map((r) => r.consulted)),
  });
  ctx.progress({ message: `${tests.length} test(s) written`, done: tests.length, total: tests.length });
  return result;
}
