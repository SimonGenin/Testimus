import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../command.ts";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { loadCorpus, runMechanical } from "../lib/check.ts";
import { columnGuidance } from "../lib/columns.ts";
import { fieldOrder, readProject, readXray, writeJson } from "../lib/project.ts";
import { readTest, testExists, writeTest } from "../lib/store.ts";
import type { ClaudeEvent, Diagnosis, Effort, Tokens } from "../types.ts";
import { checkTests, promoteChecked } from "./check.ts";
import { ledgerOf } from "./ledger.ts";
import { contextLines, readContexts } from "./prompt.ts";
import { runClaude } from "./run.ts";
import { markLeft, readRun } from "./snapshot.ts";

export const GEN_MARKER = "Use the generate-tests skill";
export const REPORT_TAG = "gen-report";

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
};

export type Uncovered = { item: string; why: string };
export type GenReport = {
  found: boolean;
  tests: string[];
  covered: string[];
  uncovered: Uncovered[];
  consulted: string[];
};

export type GenCheck = { id: string; ok: boolean; review: string; errors: number; warnings: number };

export type GenResult = {
  runId: string;
  ok: boolean;
  summary: string;
  tests: string[];
  checks: GenCheck[];
  changed: string[];
  uncovered: Uncovered[];
  reportFound: boolean;
  consulted: number;
  costUsd?: number;
  tokens?: Tokens;
  durationMs: number;
  diagnosis?: Diagnosis;
};

const clean = (xs: string[] | undefined) => [...new Set((xs ?? []).map((x) => x.trim()).filter(Boolean))];

export function checkGenInput(i: GenInput, project?: string): void {
  if (!i.request.trim() && !clean(i.requirements).length && !clean(i.sections).length && !clean(i.docs).length)
    throw new UserError(
      "Nothing to generate: the request, the requirements, the documents and the sections are all empty.",
      "Describe the feature in words, or give documents, requirement ids or document sections (DOC#§5.6.6).",
    );
  const missing = project ? clean(i.docs).filter((d) => !existsSync(join(project, "docs", d, "doc.md"))) : [];
  if (missing.length)
    throw new UserError(`No document ${missing.join(", ")} in this project.`, "testimus docs list shows them.");
  const bad = clean(i.sections).filter((s) => !/^[^#\s]+#\S.*$/.test(s));
  if (bad.length)
    throw new UserError(
      `Not a document section: ${bad.join(", ")}.`,
      "Write a section as docId#§x.y, e.g. SOSIE_211_D401-1_3#§5.6.6.",
    );
}

export function genPrompt(project: string, i: GenInput, contextIds: string[] = []): string {
  const p = readProject(project);
  const reqs = clean(i.requirements);
  const sections = clean(i.sections);
  const docs = clean(i.docs);
  const lines = [
    `${GEN_MARKER} to write Xray manual tests for the request below, in this project folder.`,
    "",
    `Request: ${i.request.trim() || "(none in words — cover the documents, requirements and sections below)"}`,
  ];
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
    "Never modify, rename or delete an existing test. Never call a tool that writes to Jira.",
  );
  lines.push(...contextLines(project, readContexts(project, contextIds), i.note));
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

export type ToolStep = { kind: "read" } | { kind: "write"; testId: string } | null;

const TEST_PATH = /tests[\\/]+(local-[0-9a-f]{8})[\\/]+test\.md/i;

export function toolStep(e: ClaudeEvent): ToolStep {
  if (e.type !== "tool") return null;
  if (/(^|_)rag_(search|passage|figure|mentions|related)$/.test(e.name)) return { kind: "read" };
  if (/^(Write|Edit|MultiEdit)$/.test(e.name)) {
    const id = e.input.match(TEST_PATH)?.[1];
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

export async function generateTests(project: string, input: GenInput, ctx: Ctx): Promise<GenResult> {
  checkGenInput(input, project);
  const p = readProject(project);
  const contexts = input.contexts ?? p.claude.contexts;
  ctx.progress({ message: "Reading passages" });
  let reads = 0;
  const written: string[] = [];
  const texts: string[] = [];
  const run = await runClaude({
    project,
    prompt: genPrompt(project, input, contexts),
    model: input.model || p.claude.model,
    effort: input.effort || p.claude.effort,
    kind: "generate",
    scope: { kind: "project" },
    contexts,
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
  const by = ctx.jobId ?? run.runId;
  // ponytail: a test is this generation's only when it did not exist before the run, a call of this run
  // wrote it, and no other generation stamped it — a test made by hand meanwhile is never claimed
  const tests = run.changedTests.filter(
    (id) =>
      before[id] === null &&
      run.written.includes(id) &&
      testExists(project, id) &&
      [undefined, "", by].includes(readTest(project, id).test.generatedBy),
  );
  const changed = run.changedTests.filter((id) => before[id] !== null && run.written.includes(id));
  // ponytail: the evidence ledger is on disk before the new tests are checked, so their first check already
  // sees what the generation never opened (related-unread); the full report replaces it below
  const ledger = ledgerOf(project, run.calls);
  const ledgerFile = join(project, ".testimus", "gen", `${by}.json`);
  writeJson(ledgerFile, {
    at: env.now().toISOString(),
    input,
    runId: run.runId,
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
  markLeft(project, run.runId, tests);
  for (const id of changed)
    ctx.log("warn", `The generation changed the existing test ${id} — revert with ${run.runId}.`);
  const report = parseGenReport(run.summary);
  const final = report.found ? report : parseGenReport(texts.join(""));
  if (!final.found && run.ok) ctx.log("warn", "The generation reply has no gen-report block: uncovered items unknown.");
  if (!run.ok) ctx.log("error", run.summary);
  const result: GenResult = {
    runId: run.runId,
    ok: run.ok,
    summary: run.summary,
    tests,
    checks,
    changed,
    uncovered: final.uncovered,
    reportFound: final.found,
    consulted: ledger.consulted.length,
    costUsd: run.costUsd,
    tokens: run.tokens,
    durationMs: run.durationMs,
    ...(run.diagnosis ? { diagnosis: run.diagnosis } : {}),
  };
  writeJson(ledgerFile, {
    at: env.now().toISOString(),
    input,
    ...result,
    covered: final.covered,
    consulted: ledger.consulted,
    searched: ledger.searched,
    reportedConsulted: final.consulted,
  });
  ctx.progress({ message: `${tests.length} test(s) written`, done: tests.length, total: tests.length });
  return result;
}
