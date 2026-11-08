import { existsSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../command.ts";
import { columnGuidance, columnText } from "../lib/columns.ts";
import { isConverted, listDocs, readDocMd } from "../lib/docs.ts";
import { readProject } from "../lib/project.ts";
import { anchorsOf } from "../rag/convert.ts";
import { readState } from "../rag/indexer.ts";
import type { Effort } from "../types.ts";
import { proposeLines } from "./actions.ts";
import type { PlannedTest } from "./gen-reply.ts";
import { CONTEXT_SLOT, contextLines, type PromptTemplate, readContexts } from "./prompt.ts";

// ponytail: what a generation is asked — its input checked, the index gate, the prompt of a run (the whole request or
// one planned test)

export const GEN_MARKER = "Use the generate-tests skill";
export const REPORT_TAG = "gen-report";
export const PLAN_TAG = "test-plan";
export const PLAN_MARKER = "use the plan-tests skill";
// ponytail: the length of a test is a preference, never a limit — said in the prompt too, so it holds over a
// generate-tests skill the team edited before this rule shipped
export const STEPS_LINE =
  "Length: aim for 3 to 15 steps per test, but the request decides — when it asks for a longer test, or a scenario does not cut cleanly, write it as long as it needs. Never refuse a test, nor skip a behavior, because of its number of steps.";
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

const clean = (xs: string[] | undefined) => [...new Set((xs ?? []).map((x) => x.trim()).filter(Boolean))];
export const isSection = (s: string) => /^[^#\s]+#\S.*$/.test(s);

function scopeSections(project: string, i: GenInput): number {
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
  return genText(
    i,
    {
      size: part ? 0 : scopeSections(project, i),
      columns: columnGuidance(project),
      folders: p.folders.join(", ") || "none",
      language: p.language,
      context: contextLines(project, readContexts(project, contextIds), i.note),
    },
    runId,
    part,
  );
}

// ponytail: what a generation run is told, from what the project says — the run and Settings › Context both call it
export function genText(
  i: Pick<GenInput, "request" | "sections" | "docs" | "folder">,
  facts: { size: number | string; columns: string[]; folders: string; language: string; context: string[] },
  runId?: string,
  part?: { n: number | string; of: number | string; request: string },
): string {
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
  const size = facts.size;
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
  lines.push(...facts.columns, "");
  lines.push(
    i.folder?.trim()
      ? `Target Xray folder: ${i.folder.trim()}`
      : `Target Xray folder: none given — pick the closest of project.json folders (${facts.folders}), else /`,
    `Language of the tests: ${languageName(facts.language)} (project.json language "${facts.language}").`,
    "",
    "Search the index thoroughly before you design (skill section 1, step 3): list the scope's terms, one rag_mentions per term with every page read, rag_search in several wordings including the negative side, rag_related on every section you cite, then each section in full in doc.md. The reviewer sees every search and every passage of this run; a test written from a handful of passages misses the exceptions, the amendments and the negative paths.",
    "Write only new tests: one folder tests/local-<8 hex>/test.md per test (tests_create allocates it), with review: draft.",
    STEPS_LINE,
    "Pictures matter as much as sources: a step that acts on or looks at a screen, a menu, a symbol or a colour gets the document's picture of it with tests_addImage (skill section 3, Figures) — when the document has one.",
    "Never modify, rename or delete an existing test. Never call a tool that writes to Jira.",
  );
  lines.push(...facts.context);
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
    '{"tests": ["local-…"], "skipped": [{"item": "<behavior>", "category": "<why, in a few words: the same words for items of the same nature>", "why": "<one or two concrete sentences: which source is missing, what the documents or context.md say>", "sources": ["<docId#anchor "quote" that asks for it>"]}], "consulted": ["<docId#anchor you read>"]}',
    "```",
    "",
  );
  return lines.join("\n");
}

const FACTS = {
  size: "{n}",
  columns: columnText([
    { name: "{column}", description: "{its description}" },
    { name: "{column with Reference source}", description: "{its description}", referenceSource: true },
    { name: "{column without description}", description: "" },
  ]),
  folders: "{project.json folders}",
  language: "{language}",
  context: CONTEXT_SLOT,
};

export const prompts: PromptTemplate[] = [
  {
    id: "generate",
    name: "Generation request",
    group: "Generation",
    usedBy: ["Generate", "gen.tests"],
    text: () =>
      genText(
        { request: "{request}", docs: ["{documents}"], sections: ["{sections}"], folder: "{folder}" },
        FACTS,
        "{runId}",
      ),
  },
  {
    id: "generate-planned",
    name: "One test of a plan",
    group: "Generation",
    usedBy: ["Generate: one run per planned test", "gen.tests"],
    text: () =>
      genText(
        { request: "{planned test} ({technique})", sections: ["{sections}"], folder: "{folder}" },
        FACTS,
        "{runId}",
        {
          n: "{k}",
          of: "{n}",
          request: "{request}",
        },
      ),
  },
];

export function plannedInput(i: GenInput, t: PlannedTest): GenInput {
  return {
    ...i,
    request: t.technique ? `${t.summary} (${t.technique})` : t.summary,
    sections: t.sections,
    docs: t.sections.length ? [] : i.docs,
  };
}
