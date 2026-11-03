import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../command.ts";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { agentPool, agentsSetting, loadLine } from "../lib/agents.ts";
import { loadCorpus, runMechanical } from "../lib/check.ts";
import { columnGuidance, fieldOrder } from "../lib/columns.ts";
import { isConverted, listDocs, readDocMd } from "../lib/docs.ts";
import { readProject } from "../lib/project.ts";
import { listLocalTests, markGenerated, readTest, removeTest, testExists, writeTest } from "../lib/store.ts";
import { anchorsOf } from "../rag/convert.ts";
import { readState } from "../rag/indexer.ts";
import { awaitsReview, type ClaudeEvent, type Diagnosis, type Effort, type Tokens } from "../types.ts";
import { proposeLines } from "./actions.ts";
import { checkTests, promoteChecked } from "./check.ts";
import { ledgerOf, readLedger, type Searched, writeLedger } from "./ledger.ts";
import { contextLines, readContexts } from "./prompt.ts";
import { newRunId, type RunResult, runClaude } from "./run.ts";
import { absorbRun, markLeft, readRun } from "./snapshot.ts";

export const GEN_MARKER = "Use the generate-tests skill";
export const REPORT_TAG = "gen-report";
export const PLAN_TAG = "test-plan";
export const PLAN_MARKER = "use the plan-tests skill";
// ponytail: every request that takes more than one test is planned, then written one run per test, as many at a time
// as the agents setting and the PC's load allow (lib/agents.ts) — the same total, a fraction of the wait

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
  sections?: string[];
  docs?: string[];
  folder?: string;
  model?: string;
  effort?: Effort;
  check?: boolean;
  contexts?: string[];
  note?: string;
  discard?: boolean;
  resume?: string;
};

export type Skipped = { item: string; why: string };
export type GenReport = {
  found: boolean;
  tests: string[];
  skipped: Skipped[];
  consulted: string[];
};

export type PlannedTest = { summary: string; technique: string; sections: string[] };
export type TestPlan = { found: boolean; tests: PlannedTest[]; skipped: Skipped[] };

export type GenCheck = { id: string; ok: boolean; review: string; errors: number; warnings: number };

export type GenResult = {
  runId: string;
  ok: boolean;
  summary: string;
  tests: string[];
  checks: GenCheck[];
  changed: string[];
  discarded: string[];
  skipped: Skipped[];
  reportFound: boolean;
  consulted: number;
  planned: number;
  generation: string;
  remaining: number;
  costUsd?: number;
  tokens?: Tokens;
  durationMs: number;
  diagnosis?: Diagnosis;
};

const clean = (xs: string[] | undefined) => [...new Set((xs ?? []).map((x) => x.trim()).filter(Boolean))];
const isSection = (s: string) => /^[^#\s]+#\S.*$/.test(s);

export function scopeSections(project: string, i: GenInput): number {
  const docs = clean(i.docs).filter((d) => existsSync(join(project, "docs", d, "doc.md")));
  return clean(i.sections).length + docs.reduce((n, d) => n + anchorsOf(readDocMd(project, d)).sections.length, 0);
}

export type PlanPart = { n: number; of: number; request: string };

export function checkGenInput(i: GenInput, project?: string): void {
  if (!i.request.trim() && !clean(i.sections).length && !clean(i.docs).length)
    throw new UserError(
      "Nothing to generate: the request, the documents and the sections are all empty.",
      "Describe the feature in words, or give documents or document sections (DOC#§5.6.6).",
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

// ponytail: a document search cannot find gives tests without sources, so the run is refused; one changed since the
// last index is still found (its old passages), so the run goes on with a warning
export function scopeIndex(
  project: string,
  i: Pick<GenInput, "docs" | "sections">,
): { searched: string[]; unindexed: string[]; stale: string[] } {
  const asked = new Set([...clean(i.docs), ...clean(i.sections).map((s) => s.split("#")[0])]);
  const docs = listDocs(project).filter((d) => isConverted(d) && (!asked.size || asked.has(d.id)));
  return {
    searched: docs.map((d) => d.id),
    unindexed: docs.filter((d) => d.indexed === "missing").map((d) => d.id),
    stale: docs.filter((d) => d.indexed === "stale").map((d) => d.id),
  };
}

export function indexGate(project: string, i: GenInput): string[] {
  const { searched, unindexed: missing, stale } = scopeIndex(project, i);
  if (!searched.length)
    throw new UserError(
      "No converted document to generate from.",
      "Add a document in Documents (testimus docs add), then convert it.",
    );
  if (missing.length)
    throw new UserError(
      readState(project)
        ? `Not indexed: ${missing.join(", ")}. Search cannot find ${missing.length === 1 ? "it" : "them"}, so the tests would have no sources.`
        : "The index does not exist yet: search cannot find any document, so the tests would have no sources.",
      "Reindex (Documents, Settings › Search, or testimus rag index), or leave these documents out of the scope.",
    );
  return stale;
}

export function genPrompt(
  project: string,
  i: GenInput,
  contextIds: string[] = [],
  runId?: string,
  part?: PlanPart,
): string {
  const p = readProject(project);
  const sections = clean(i.sections);
  const docs = clean(i.docs);
  const lines = [
    `${GEN_MARKER} to write Xray manual tests for the request below, in this project folder.`,
    "",
    `Request: ${i.request.trim() || "(none in words — test the documents and sections below)"}`,
  ];
  if (part)
    lines.push(
      `This is test ${part.n} of ${part.of} of a plan${part.request ? ` for: ${part.request}` : ""}. Write exactly this one test; the other tests of the plan are written by other runs.`,
    );
  const size = part ? 0 : scopeSections(project, i);
  if (!part)
    lines.push(
      `The scope holds ${size} section${size === 1 ? "" : "s"}. When testing it takes more than one test, ${PLAN_MARKER} instead: write no test, and end your reply with its ${PLAN_TAG} block instead of the report block below.`,
    );
  if (docs.length)
    lines.push(
      `Documents in scope, each in full (${i.request.trim() ? "find in them what the request is about" : "test the behaviors they specify"}): ${docs.join(", ")}`,
    );
  if (sections.length)
    lines.push(`Document sections in scope (read each with rag_passage and in doc.md): ${sections.join(", ")}`);
  lines.push(...columnGuidance(project), "");
  lines.push(
    i.folder?.trim()
      ? `Target Xray folder: ${i.folder.trim()}`
      : `Target Xray folder: none given — pick the closest of project.json folders (${p.folders.join(", ") || "none"}), else /`,
    `Language of the tests: ${languageName(p.language)} (project.json language "${p.language}").`,
    "",
    "Search the index thoroughly before you design (skill section 1, step 3): list the scope's terms, one rag_mentions per term with every page read, rag_search in several wordings including the negative side, rag_related on every section you cite, then each section in full in doc.md. The reviewer sees every search and every passage of this run; a test written from a handful of passages misses the exceptions, the amendments and the negative paths.",
    "Write only new tests: one folder tests/local-<8 hex>/test.md per test (tests_create allocates it), with review: draft.",
    "Pictures matter as much as sources: a step that acts on or looks at a screen, a menu, a symbol or a colour gets the document's picture of it with tests_addImage (skill section 3, Figures) — when the document has one.",
    "Never modify, rename or delete an existing test. Never call a tool that writes to Jira.",
  );
  lines.push(...contextLines(project, readContexts(project, contextIds), i.note));
  if (runId)
    lines.push(
      ...proposeLines(
        runId,
        'a document section you could not test because its text is a picture or a table the conversion lost — { kind: "doc", docId }, where: "doc:<docId>"',
      ),
    );
  lines.push(
    "",
    `When you finish, end your reply with the report block of the skill (section 4), exactly this shape:`,
    "```" + REPORT_TAG,
    '{"tests": ["local-…"], "skipped": [{"item": "<behavior>", "why": "<reason>"}], "consulted": ["<docId#anchor you read>"]}',
    "```",
    "",
  );
  return lines.join("\n");
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : [];
}

function asSkipped(v: unknown): Skipped[] {
  if (!Array.isArray(v)) return [];
  const out: Skipped[] = [];
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
// "skipped" is accepted too, because a model sometimes drops the tag — anything else is no report
export function parseGenReport(text: string): GenReport {
  const blocks = [...text.matchAll(/```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)```/g)];
  const tagged = blocks.filter((b) => b[1] === REPORT_TAG);
  const loose = blocks.filter((b) => b[1] !== REPORT_TAG && b[2].includes('"skipped"'));
  for (const b of [...tagged.reverse(), ...loose.reverse()]) {
    try {
      const o = JSON.parse(b[2]) as Record<string, unknown>;
      if (!o || typeof o !== "object" || Array.isArray(o)) continue;
      return {
        found: true,
        tests: asStrings(o.tests),
        skipped: asSkipped(o.skipped),
        consulted: asStrings(o.consulted),
      };
    } catch {}
  }
  return { found: false, tests: [], skipped: [], consulted: [] };
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
          sections: asStrings(x.sections).filter(isSection),
        });
      }
      if (tests.length) return { found: true, tests, skipped: asSkipped(o.skipped) };
    } catch {}
  }
  return { found: false, tests: [], skipped: [] };
}

export function plannedInput(i: GenInput, t: PlannedTest): GenInput {
  return {
    ...i,
    request: t.technique ? `${t.summary} (${t.technique})` : t.summary,
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
  writeTest(project, id, want, fieldOrder(project));
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
  o: { runId: string; by: string; contexts: string[]; prompt: string; label: string; title?: string },
): Promise<GenRun> {
  const p = readProject(project);
  let reads = 0;
  const written: string[] = [];
  const texts: string[] = [];
  const run = await runClaude({
    project,
    runId: o.runId,
    label: o.label,
    ...(o.title ? { title: o.title } : {}),
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

type Prior = {
  input: GenInput;
  runId: string;
  tests: string[];
  consulted: string[];
  searched: Searched[];
  plan: TestPlan;
  done: number[];
};

export function readPrior(project: string, generation: string): Prior {
  const l = readLedger(project, generation);
  if (!l?.input || !l.runId || !l.plan?.tests?.length)
    throw new UserError(
      `No plan to resume under ${generation}.`,
      "Only a generation written from a plan can be resumed: its result names it (generation).",
    );
  return {
    input: l.input,
    runId: l.runId,
    tests: l.tests ?? [],
    consulted: l.consulted ?? [],
    searched: l.searched ?? [],
    plan: l.plan,
    done: l.done ?? [],
  };
}

export async function generateTests(project: string, asked: GenInput, ctx: Ctx): Promise<GenResult> {
  const prior = asked.resume?.trim() ? readPrior(project, asked.resume.trim()) : null;
  const input = prior
    ? { ...prior.input, model: asked.model || prior.input.model, effort: asked.effort || prior.input.effort }
    : asked;
  if (!prior) checkGenInput(input, project);
  const stale = indexGate(project, input);
  if (stale.length)
    ctx.log(
      "warn",
      `Index not up to date for ${stale.join(", ")}: what changed since the last index is not searched. Reindex to include it.`,
    );
  const p = readProject(project);
  const discarded = input.discard && !prior ? discardable(project) : [];
  for (const id of discarded) removeTest(project, id);
  if (discarded.length)
    ctx.log("info", `Deleted ${discarded.length} test(s) not validated yet: ${discarded.join(", ")}.`);
  const contexts = input.contexts ?? p.claude.contexts;
  ctx.steps?.([
    ...(prior ? [] : [{ id: "read", label: "Read the sources" }]),
    { id: "write", label: "Write the tests" },
    ...(input.check !== false ? [{ id: "check", label: "Check the new tests" }] : []),
  ]);
  if (!prior) ctx.step?.("read");
  ctx.progress({ message: "Reading passages" });
  const runId = prior?.runId ?? newRunId();
  const by = asked.resume?.trim() || ctx.jobId || runId;
  const first = prior
    ? null
    : await genRun(ctx, project, input, {
        runId,
        by,
        contexts,
        prompt: genPrompt(project, input, contexts, runId),
        label: "generate",
        title: "read and write",
      });
  const plan = prior?.plan ?? (first && !first.tests.length && first.run.ok ? parsePlan(first.run.summary) : null);
  const of = plan?.found ? plan.tests.length : 0;
  const done = new Set(prior?.done ?? []);
  const todo = plan?.found ? plan.tests.map((t, k) => ({ t, k })).filter(({ k }) => !done.has(k)) : [];
  if (todo.length) ctx.step?.("write");
  if (prior) ctx.log("info", `Resuming the plan: ${todo.length} of ${of} test(s) left.`);
  const set = agentsSetting();
  if (todo.length && !prior)
    ctx.log(
      "info",
      `Plan: ${of} test(s), one run each, ${set.adaptive ? `up to ${set.max} at a time as the PC allows` : `${set.max} at a time`}.`,
    );
  const pool = agentPool({
    onLimit: (n, load) => ctx.log("info", `Agents: ${n} at a time (${loadLine(load)}).`),
  });
  let finished = 0;
  let stop = false;
  // ponytail: a failed run stops the runs not started yet (a credit or login failure would fail them all); a planned
  // test counts as written once its run wrote a test, so a resume never writes it twice
  const parts = await Promise.all(
    todo.map(({ t, k }) =>
      pool.run(async () => {
        if (stop || ctx.signal.aborted) return null;
        ctx.progress({
          message: `Test ${k + 1} of ${of}: ${t.summary} (${pool.active()} running)`,
          done: finished,
          total: todo.length,
        });
        const id = newRunId();
        const part = plannedInput(input, t);
        const r = await genRun(ctx, project, part, {
          runId: id,
          by,
          contexts,
          prompt: genPrompt(project, part, contexts, id, { n: k + 1, of, request: input.request.trim() }),
          label: `generate ${k + 1}/${of}`,
          title: t.summary,
        });
        absorbRun(project, runId, id);
        finished++;
        if (r.run.ok || r.tests.length) done.add(k);
        if (!r.run.ok) stop = true;
        return r;
      }),
    ),
  );
  const planned = parts.filter((r): r is GenRun => !!r);
  const runs = first ? [first, ...planned] : planned;
  const left = plan?.found ? plan.tests.filter((_, k) => !done.has(k)) : [];
  const tests = union(runs.map((r) => r.tests));
  const changed = union(runs.map((r) => r.changed));
  // ponytail: the evidence ledger is on disk before the new tests are checked, so their first check already
  // knows what the generation opened; the full report replaces it below
  const ledger = ledgerOf(
    project,
    runs.flatMap((r) => r.run.calls),
  );
  const consulted = union([prior?.consulted ?? [], ledger.consulted]);
  const searched = [...(prior?.searched ?? []), ...ledger.searched];
  const kept = {
    tests: union([prior?.tests ?? [], tests]),
    consulted,
    searched,
    ...(plan?.found ? { plan, done: [...done].sort((a, b) => a - b) } : {}),
  };
  writeLedger(project, by, { at: env.now().toISOString(), input, runId, ...kept });
  for (const id of tests) stampTest(project, id, by, input.folder?.trim() || undefined);
  const checks: GenCheck[] = [];
  if (tests.length && input.check !== false && !ctx.signal.aborted) {
    ctx.step?.("check");
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
  const reports = planned.length || !first ? planned.map((r) => r.report) : [first.report];
  const reportFound = reports.every((r) => r.found);
  const failed = runs.find((r) => !r.run.ok)?.run;
  if (!reportFound && !failed) ctx.log("warn", "The generation reply has no gen-report block: skipped items unknown.");
  if (failed) ctx.log("error", failed.summary);
  if (left.length)
    ctx.log("warn", `${left.length} planned test(s) not written — resume with gen.tests --resume ${by}.`);
  const why = `not written: the generation ${ctx.signal.aborted ? "was cancelled" : "stopped on a failed run"} — resume it`;
  const sum = (f: (r: RunResult) => number | undefined) =>
    runs.some((r) => f(r.run) !== undefined) ? runs.reduce((a, r) => a + (f(r.run) ?? 0), 0) : undefined;
  const tokensIn = sum((r) => r.tokens?.input);
  const output = sum((r) => r.tokens?.output);
  const costUsd = sum((r) => r.costUsd);
  const diagnosis = failed?.diagnosis;
  const result: GenResult = {
    runId,
    ok: !failed,
    summary:
      planned.length || !first
        ? [`Plan: ${of} test(s).`, ...planned.map((r) => r.run.summary)].join("\n\n")
        : first.run.summary,
    tests,
    checks,
    changed,
    discarded,
    skipped: [
      ...(first ? (plan?.skipped ?? []) : []),
      ...reports.flatMap((r) => r.skipped),
      ...left.map((t) => ({ item: t.summary, why })),
    ],
    reportFound,
    consulted: consulted.length,
    planned: planned.length,
    generation: by,
    remaining: left.length,
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(tokensIn !== undefined && output !== undefined ? { tokens: { input: tokensIn, output } } : {}),
    durationMs: runs.reduce((a, r) => a + r.run.durationMs, 0),
    ...(diagnosis ? { diagnosis } : {}),
  };
  writeLedger(project, by, {
    at: env.now().toISOString(),
    input,
    ...result,
    ...kept,
    reportedConsulted: union(reports.map((r) => r.consulted)),
  });
  ctx.progress({ message: `${tests.length} test(s) written`, done: tests.length, total: tests.length });
  return result;
}
