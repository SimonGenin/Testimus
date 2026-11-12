import { existsSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../command.ts";
import { columnGuidance, columnText } from "../lib/columns.ts";
import { isConverted, listDocs, readDocMd } from "../lib/docs.ts";
import { readProject } from "../lib/project.ts";
import { anchorsOf } from "../rag/convert.ts";
import { readState } from "../rag/indexer.ts";
import type { Effort } from "../types.ts";
import {
  isSection,
  PLAN_TAG,
  type PlannedTest,
  REASON_HELP,
  REASON_LABEL,
  REPORT_TAG,
  type Skipped,
} from "./gen-reply.ts";
import { GIVEN_SLOT } from "./given.ts";
import { languageName } from "./language.ts";
import type { PromptTemplate } from "./prompt.ts";

// ponytail: what a generation is asked — its input checked, the index gate, the prompt of a run (the whole request or
// one planned test). The prompt holds what is this run's alone: the request, its scope, the columns, the folder, the
// language and the shape of the report; how to search, design and write is the generate-tests skill's, said once

export const GEN_MARKER = "Use the generate-tests skill";
export const PLAN_MARKER = "use the plan-tests skill";
// ponytail: the length of a test is a preference, never a limit — said in the prompt too, so it holds over a
// generate-tests skill the team edited before this rule shipped
export const STEPS_LINE =
  "Length: about 3 to 15 steps per test, but the request decides — a test is written as long as it needs. Never refuse a test, nor leave a behavior out, because of its number of steps.";
// ponytail: every request that takes more than one test is planned, then written one run per test, as many at a time
// as the agents setting and the PC's load allow (lib/agents.ts) — the same total, a fraction of the wait

export type GenInput = {
  request: string;
  sections?: string[];
  docs?: string[];
  folder?: string;
  model?: string;
  effort?: Effort;
  check?: boolean;
  contexts?: string[];
  without?: string[];
  note?: string;
  discard?: boolean;
  resume?: string;
};

const clean = (xs: string[] | undefined) => [...new Set((xs ?? []).map((x) => x.trim()).filter(Boolean))];

function scopeSections(project: string, i: GenInput): number {
  const docs = clean(i.docs).filter((d) => existsSync(join(project, "docs", d, "doc.md")));
  return clean(i.sections).length + docs.reduce((n, d) => n + anchorsOf(readDocMd(project, d)).sections.length, 0);
}

/** the documents a generation is about: the ones asked whole and those of the sections asked */
export const scopeDocs = (i: Pick<GenInput, "docs" | "sections">): string[] => [
  ...new Set([...clean(i.docs), ...clean(i.sections).map((s) => s.split("#")[0])]),
];

// ponytail: another test of the same plan, as a planned run is told it — its number, what it is about, the sections it
// is written from, and its test once a run created it
export type PlanSibling = { n: number; summary: string; sections: string[]; ids?: string[] };
export type PlanPart = { n: number; of: number; request: string; others?: PlanSibling[] };

// ponytail: what a run that adds to an earlier generation is told (gen.revise add) — the generation's first request,
// the tests it has (never written again) and the items it left without a test (written now when the request covers
// them, and named back under « covered »)
export type AddPart = { request: string; tests: string[]; skipped: Skipped[] };
export type GenMore = { add?: AddPart };

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
// last index is still found (its old passages), so the run goes on with a warning. A document the user left out of
// the run is not searched
export function scopeIndex(
  project: string,
  i: Pick<GenInput, "docs" | "sections" | "without">,
): { searched: string[]; unindexed: string[]; stale: string[] } {
  const asked = new Set(scopeDocs(i));
  const out = new Set((i.without ?? []).flatMap((w) => (w.startsWith("doc:") ? [w.slice(4)] : [])));
  const docs = listDocs(project).filter((d) => isConverted(d) && !out.has(d.id) && (!asked.size || asked.has(d.id)));
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
  context: string[] = [],
  part?: PlanPart,
  more: GenMore = {},
): string {
  const p = readProject(project);
  return genText(
    i,
    {
      size: part ? 0 : scopeSections(project, i),
      columns: columnGuidance(project),
      folders: p.folders.join(", ") || "none",
      language: p.language,
      context,
    },
    part,
    more,
  );
}

const REASONS = (Object.keys(REASON_HELP) as (keyof typeof REASON_HELP)[]).join(" | ");

export const reportShape = (covered: boolean): string =>
  `{"tests": ["local-…"], "skipped": [{"item": "<the behavior>", "reason": "${REASONS}", "why": "<one or two concrete sentences>", "sources": ["<docId#anchor \\"quote\\" that asks for it>"], "searched": ["<what you searched>"], "read": ["<docId#anchor you opened>"], "unblock": "<what would let it be written, and who can bring it>", "test": "<already-tested: the id of the test>"}]${covered ? ', "covered": ["<an item listed above you wrote a test for>"]' : ""}}`;

// ponytail: what a generation run is told, from what the project says — the run and Settings › Context both call it
export function genText(
  i: Pick<GenInput, "request" | "sections" | "docs" | "folder">,
  facts: { size: number | string; columns: string[]; folders: string; language: string; context: string[] },
  part?: {
    n: number | string;
    of: number | string;
    request: string;
    others?: (Omit<PlanSibling, "n"> & { n: number | string })[];
  },
  more: GenMore = {},
): string {
  const sections = clean(i.sections);
  const docs = clean(i.docs);
  const lines = [
    `${GEN_MARKER} to write Xray manual tests for the request below.`,
    "",
    `Request: ${i.request.trim() || "(none in words — test what the documents and sections below specify)"}`,
  ];
  if (part)
    lines.push(
      `This is test ${part.n} of ${part.of} of a plan${part.request ? ` for: ${part.request}` : ""}. Write exactly this one test. What the other tests of the plan take is theirs: it is not left out, never report it.`,
    );
  if (part?.others?.length)
    lines.push(
      "The other tests of the plan — what one of them covers is neither written here nor reported; if you must name one (already-tested), give its test id, else plan:<its number>:",
      ...part.others.map(
        (o) =>
          `- plan:${o.n} ${o.summary}${o.sections.length ? ` — ${o.sections.join(", ")}` : ""}${o.ids?.length ? ` (${o.ids.join(", ")})` : ""}`,
      ),
    );
  const add = more.add;
  if (add) {
    lines.push(`This adds tests to an earlier generation${add.request.trim() ? ` for: ${add.request.trim()}` : ""}.`);
    if (add.tests.length)
      lines.push("It already has these tests — never write them again:", ...add.tests.map((t) => `- ${t}`));
    if (add.skipped.length)
      lines.push(
        'Left without a test before — write each one the request covers and a source now supports, and name it under "covered":',
        // ponytail: an item of a ledger older than the reasons keeps its own words (its category)
        ...add.skipped.map((s) => `- ${s.item} (${s.category || REASON_LABEL[s.reason]}${s.why ? `: ${s.why}` : ""})`),
      );
  }
  const size = facts.size;
  if (!part)
    lines.push(
      `The scope holds ${size} section${size === 1 ? "" : "s"}. When it takes more than one test, ${PLAN_MARKER} instead: write no test and end your reply with its ${PLAN_TAG} block.`,
    );
  if (docs.length)
    lines.push(
      `Documents in scope, each in full (${i.request.trim() ? "find in them what the request is about" : "test the behaviors they specify"}): ${docs.join(", ")}`,
    );
  if (sections.length) lines.push(`Sections in scope: ${sections.join(", ")}`);
  // ponytail: the search is the plan's when it gave this test its sections — four planned runs that each search the
  // scope again cost four times the turns for the same passages (measured: 4.7 M tokens for four tests of one
  // section); a planned test given whole documents has no section to read and searches like any other
  lines.push(
    "",
    part && sections.length
      ? "The plan already searched the scope: read the sections above in full, follow what they refer to (rag_related), and search again only for a term they bring that the plan could not have seen."
      : "Search before you design, as section 1 of the skill says: one rag_mentions per term of the scope, the behavior in other words and its negative side, rag_related on each section you will cite, each section read in full. The reviewer sees every search and every passage opened; a test written from a handful of passages misses the exception, the amendment and the refusal.",
  );
  lines.push(...facts.columns, "");
  lines.push(
    i.folder?.trim()
      ? `Xray folder of the tests: ${i.folder.trim()}`
      : `Xray folder of the tests: none given — ${facts.folders === "none" ? "/" : `the closest of ${facts.folders}, else /`}`,
    `Language of the tests: ${languageName(facts.language)}.`,
    STEPS_LINE,
  );
  lines.push(...facts.context);
  lines.push(
    "",
    "End your reply with the report of the skill — every behavior of the request you wrote no step for, each with its reason and what you did before giving up:",
    "```" + REPORT_TAG,
    reportShape(!!add?.skipped.length),
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
  context: GIVEN_SLOT,
};

const REPORTED =
  "The tests written (snapshotted) and a report block: each behavior left without a test, with a reason from a closed list, what was searched and read, the passage that asks for it and what would let it be written. A report that cannot be read is asked again";

export const prompts: PromptTemplate[] = [
  {
    id: "generate",
    name: "Generation request",
    group: "Generation",
    kind: "generate",
    usedBy: ["Generate", "gen.tests"],
    answers: `${REPORTED}; or a plan of tests when the scope takes more than one`,
    text: () =>
      genText({ request: "{request}", docs: ["{documents}"], sections: ["{sections}"], folder: "{folder}" }, FACTS),
  },
  {
    id: "generate-planned",
    name: "One test of a plan",
    group: "Generation",
    kind: "generate",
    usedBy: ["Generate: one run per planned test", "gen.tests"],
    answers: REPORTED,
    text: () =>
      genText({ request: "{planned test} ({technique})", sections: ["{sections}"], folder: "{folder}" }, FACTS, {
        n: "{k}",
        of: "{n}",
        request: "{request}",
        others: [
          {
            n: "{j}",
            summary: "{another planned test}",
            sections: ["{its sections}"],
            ids: ["{its test, once written}"],
          },
        ],
      }),
  },
  {
    id: "generate-add",
    name: "More tests for a generation",
    group: "Generation",
    kind: "generate",
    usedBy: ["Generate › Ask for changes › Add tests", "gen.revise (add)"],
    answers: REPORTED,
    text: () =>
      genText(
        { request: "{request}", docs: ["{documents}"], sections: ["{sections}"], folder: "{folder}" },
        FACTS,
        undefined,
        {
          add: {
            request: "{first request}",
            tests: ["{test it already has}"],
            skipped: [{ item: "{item left without a test}", reason: "no-source", category: "", why: "{why}" }],
          },
        },
      ),
  },
];

// ponytail: what a person reads of a generation in the jobs — how many tests once a plan says it, else the words of the
// request without the preamble that only says « write tests for », else its documents and sections
const PREAMBLE =
  /^(?:please\s+|merci de\s+)?(?:g[ée]n[èe]re[rz]?|generate|write|[ée]cri(?:re|s|vez)|r[ée]dige[rz]?|cr[ée]e[rz]?|create|draft)\s+(?:(?:les|des|un|une|le|the|a|some)\s+)?(?:tests?|cas de tests?|test cases?)\b[\s:,]*(?:(?:pour|sur|de|du|des|d'|for|on|of|about|covering)\s*)?/i;

export function genLabel(i: Pick<GenInput, "request" | "docs" | "sections">, planned?: number): string {
  if (planned) return `Generate ${planned} test${planned === 1 ? "" : "s"}`;
  const words = i.request.trim().replace(PREAMBLE, "").trim();
  const s = words ? words[0].toUpperCase() + words.slice(1) : [...clean(i.docs), ...clean(i.sections)].join(", ");
  if (!s) return "";
  return `Generate: ${s.length > 80 ? `${s.slice(0, 77)}...` : s}`;
}

export function plannedInput(i: GenInput, t: PlannedTest): GenInput {
  return {
    ...i,
    request: t.technique ? `${t.summary} (${t.technique})` : t.summary,
    sections: t.sections,
    docs: t.sections.length ? [] : i.docs,
  };
}
