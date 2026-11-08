import { DEFAULT_DESCRIPTIONS, stepColumns } from "../lib/columns.ts";
import { listDocs } from "../lib/docs.ts";
import { isMediaDoc, sourceType } from "../lib/media.ts";
import { readProject, readXray } from "../lib/project.ts";
import { listLocalTests, readTest } from "../lib/store.ts";
import type { ClaudeEvent, Diagnosis, StepColumn, XrayJson } from "../types.ts";
import { languageName } from "./gen-prompt.ts";
import { CONTEXT_SLOT, contextLines, type PromptTemplate, readContexts } from "./prompt.ts";
import { runClaude } from "./run.ts";

export const COLUMNS_MARKER = "Testimus smart columns";
export const COLUMNS_TAG = "columns";

const MAX_TESTS = 60;
const MAX_EXAMPLES = 3;

export type ColumnProposal = {
  name: string;
  kind: "xray" | "local" | "new";
  builtin: boolean;
  current: string | null;
  description: string;
  why: string;
};

export type SuggestResult = {
  ok: boolean;
  proposals: ColumnProposal[];
  summary: string;
  costUsd?: number;
  diagnosis?: Diagnosis;
};

type Use = { steps: number; filled: number; tests: number; examples: string[] };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const oneLine = (s: string, n: number) => {
  const t = s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "[image]")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// ponytail: what the tests already hold is the team's habit — the tests pulled from Xray first, since the team
// wrote those; a column nobody fills says as much as the description
export function columnUse(project: string, names: string[]): Map<string, Use> {
  const uses = new Map(names.map((n) => [n, { steps: 0, filled: 0, tests: 0, examples: [] as string[] }]));
  const refs = listLocalTests(project)
    .sort((a, b) => Number(!a.key) - Number(!b.key))
    .slice(0, MAX_TESTS);
  for (const r of refs) {
    let steps: { fields: Record<string, string> }[] = [];
    try {
      steps = readTest(project, r.id).test.steps;
    } catch {
      continue;
    }
    for (const [name, u] of uses) {
      let here = false;
      for (const s of steps) {
        u.steps++;
        const v = (s.fields[name] ?? "").trim();
        if (!v) continue;
        u.filled++;
        here = true;
        if (u.examples.length < MAX_EXAMPLES) u.examples.push(`${r.key ?? r.id}: ${oneLine(v, 140)}`);
      }
      if (here) u.tests++;
    }
  }
  return uses;
}

function tagOf(c: StepColumn): string {
  if (c.origin === "local") return c.status === "gone" ? "local (was in Xray, removed there)" : "local only";
  return c.builtin ? "Xray standard" : "Xray custom field";
}

function columnLines(columns: StepColumn[], x: XrayJson, uses: Map<string, Use>): string[] {
  const lines: string[] = [];
  for (const c of columns) {
    const field = x.fields.find((f) => same(f.name, c.name));
    const shape = [
      tagOf(c),
      field?.type && field.type !== "text" ? `type ${field.type}` : "",
      field?.required ? "required in Xray" : "",
      c.mode === "hidden" ? "hidden in the editor" : "",
      c.status === "new" ? "new in Xray, never described" : "",
    ].filter(Boolean);
    lines.push(`- ${c.name} (${shape.join(", ")})`);
    lines.push(`  description: ${c.description ? c.description : "(empty — Claude never fills it)"}`);
    const u = uses.get(c.name);
    if (u?.steps) {
      lines.push(`  in the tests: filled in ${u.filled} of ${u.steps} steps, in ${u.tests} tests`);
      for (const e of u.examples) lines.push(`    e.g. ${e}`);
    }
  }
  return lines;
}

export function columnsPrompt(project: string, ask: string, contexts: string[], note = ""): string {
  const p = readProject(project);
  const x = readXray(project);
  const columns = stepColumns(project, x);
  const uses = columnUse(
    project,
    columns.map((c) => c.name),
  );
  return columnsText(ask, {
    project: `${p.name || p.jiraProject || "(unnamed)"}${p.jiraProject ? `, Jira project ${p.jiraProject}` : ""}`,
    language: p.language,
    fetchedAt: x.fetchedAt ?? "",
    columns: columnLines(columns, x, uses),
    docs: listDocs(project)
      .map(
        (d) =>
          `${d.id} « ${oneLine(d.title, 80)} » v${d.version || "?"} ${d.status}${isMediaDoc(d) ? ` ${sourceType(d)}, ${d.reference ? "reference" : "observed"}` : ""}`,
      )
      .join("; "),
    glossary: Object.entries(p.glossary ?? {})
      .slice(0, 40)
      .map(([k, v]) => `- ${k}: ${oneLine(v, 120)}`),
    context: contextLines(project, readContexts(project, contexts), note),
  });
}

export const prompts: PromptTemplate[] = [
  {
    id: "columns",
    name: "Propose the smart columns",
    group: "Smart columns",
    usedBy: ["Settings › Smart columns: Ask Claude", "columns.suggest"],
    text: () =>
      columnsText("{request}", {
        project: "{project name}, Jira project {key}",
        language: "{language}",
        fetchedAt: "{date}",
        columns: [
          "- {column} ({Xray standard, Xray custom field or local only; its type; required, hidden, new})",
          "  description: {its description}",
          "  in the tests: filled in {n} of {m} steps, in {t} tests",
          "    e.g. {test}: {what a step holds}",
        ],
        docs: "{document} « {title} » v{version} {status}; …",
        glossary: ["- {term}: {meaning}"],
        context: CONTEXT_SLOT,
      }),
  },
];

type ColumnFacts = {
  project: string;
  language: string;
  fetchedAt: string;
  columns: string[];
  docs: string;
  glossary: string[];
  context: string[];
};

function columnsText(ask: string, f: ColumnFacts): string {
  const lines = [
    `${COLUMNS_MARKER}: use the define-columns skill to propose the step columns of this project and what`,
    "Claude writes in each. Nothing is saved by you: the user applies the proposals one by one.",
    "",
    ask.trim()
      ? `The user asks: « ${ask.trim()} »`
      : "No request: review every column against the documents and the tests.",
    "",
    `Project: ${f.project}.`,
    `Language of the tests: ${languageName(f.language)} (project.json language "${f.language}"). Write the descriptions in the language the current ones use.`,
    f.fetchedAt
      ? `Xray's step fields were read on ${f.fetchedAt}.`
      : "Xray's step fields were never read: the Xray columns below are the defaults, the project's Xray may hold more.",
    "",
    "The smart columns today, in display order:",
    ...f.columns,
    "",
    "Testimus' defaults for Xray's standard columns (the team reuses them unless the documents need otherwise):",
    ...Object.entries(DEFAULT_DESCRIPTIONS).map(([k, v]) => `- ${k}: ${v}`),
    "",
    f.docs
      ? `Documents (docs_show, rag_search, rag_passage, docs/<id>/doc.md): ${f.docs}`
      : "The project has no document yet: work from the tests, the contexts and the request.",
    ...(f.glossary.length ? ["", "Project glossary:", ...f.glossary] : []),
    ...f.context,
    "",
    "Reply in 2-4 lines in English: what you looked at and what you propose. End the reply with this block, valid",
    "JSON, nothing after it — only the columns you would change or add, each with its whole new description:",
    `\`\`\`${COLUMNS_TAG}`,
    '{"columns": [{"name": "Expected Result", "description": "…", "why": "…"}]}',
    "```",
    "",
  ];
  return lines.join("\n");
}

export function parseColumns(text: string): { name: string; description: string; why: string }[] | null {
  const blocks = [...text.matchAll(/```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)```/g)];
  for (const b of [...blocks.filter((m) => m[1] === COLUMNS_TAG), ...blocks.filter((m) => m[1] !== COLUMNS_TAG)]) {
    try {
      const o = JSON.parse(b[2]) as unknown;
      const list = Array.isArray(o) ? o : (o as { columns?: unknown })?.columns;
      if (!Array.isArray(list)) continue;
      const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      return list
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
        .map((c) => ({ name: str(c.name), description: str(c.description), why: str(c.why) }))
        .filter((c) => c.name);
    } catch {}
  }
  return null;
}

// ponytail: a proposal is matched to the column it names, whatever its case; one that changes nothing is dropped
export function toProposals(columns: StepColumn[], raw: { name: string; description: string; why: string }[]) {
  const out: ColumnProposal[] = [];
  for (const r of raw) {
    const c = columns.find((cc) => same(cc.name, r.name));
    if (c && c.description.trim() === r.description) continue;
    if (out.some((o) => same(o.name, r.name))) continue;
    out.push({
      name: c?.name ?? r.name,
      kind: c ? c.origin : "new",
      builtin: !!c?.builtin,
      current: c ? c.description : null,
      description: r.description,
      why: r.why,
    });
  }
  return out;
}

export async function suggestColumns(o: {
  project: string;
  ask: string;
  contexts?: string[];
  note?: string;
  model?: string;
  signal?: AbortSignal;
  onEvent?(e: ClaudeEvent): void;
}): Promise<SuggestResult> {
  const p = readProject(o.project);
  const contexts = [...new Set([...p.claude.contexts, ...(o.contexts ?? [])])];
  const run = await runClaude({
    kind: "columns",
    project: o.project,
    prompt: columnsPrompt(o.project, o.ask, contexts, o.note),
    model: o.model ?? p.claude.model,
    effort: "medium",
    contexts,
    signal: o.signal,
    onEvent: o.onEvent,
  });
  const base = { summary: run.summary, costUsd: run.costUsd, diagnosis: run.diagnosis };
  const raw = run.ok ? parseColumns(run.summary) : null;
  if (!raw) return { ok: false, proposals: [], ...base };
  return { ok: true, proposals: toProposals(stepColumns(o.project), raw), ...base };
}
