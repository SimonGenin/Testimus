import { type Ctx, UserError } from "../command.ts";
import { env } from "../env.ts";
import { docIds, docShape, readContext, readDoc } from "../lib/docs.ts";
import { isObserved, sourceType } from "../lib/media.ts";
import {
  basisOf,
  changesSince,
  type DocChange,
  keepLastUpdate,
  OVERVIEW_LINE,
  OVERVIEW_PATH,
  type OverviewKind,
  overviewOption,
  overviewWarnings,
  readOverview,
  type SectionChanges,
  sectionDiff,
  sectionsOf,
  writeOverview,
} from "../lib/overview.ts";
import { readProject } from "../lib/project.ts";
import type { DocJson } from "../types.ts";
import { keepForOverview, strayWrites, undoWrites } from "./overview-scope.ts";
import type { JobRun, PromptTemplate } from "./prompt.ts";
import { runClaude } from "./run.ts";

export const OVERVIEW_MARKER = "Use the overview-documents skill";
export type OverviewMode = "auto" | "full";

const TYPE: Record<string, string> = {
  docx: "Word",
  pdf: "PDF",
  txt: "text",
  images: "images",
  video: "video",
  mixed: "images and video",
};
const OUTLINE = 30;

// ponytail: what Claude is told of a document it has to place — its card and its outline (the first headings), never
// its text: the run reads more through docs_show and rag_search when a link needs it
export function docSummary(project: string, doc: DocJson): string[] {
  const facts = [
    TYPE[sourceType(doc)],
    doc.kind,
    doc.version && `version ${doc.version}`,
    doc.date,
    doc.status,
    isObserved(doc) ? "observed: shows the real system" : "",
    doc.amends?.length ? `amends ${doc.amends.join(", ")}` : "",
    doc.relatesTo?.length ? `about ${doc.relatesTo.join(", ")}` : "",
  ].filter(Boolean);
  const shape = docShape(project, doc.id);
  const toc = shape.toc.filter((t) => t.level <= 2);
  const outline = toc
    .slice(0, OUTLINE)
    .map((t) => `${t.anchor} ${t.title}`.trim())
    .join(" · ");
  const more = toc.length > OUTLINE ? ` · … ${toc.length - OUTLINE} more` : "";
  const note = readContext(project, doc.id).trim().replace(/\s+/g, " ");
  return [
    `- ${doc.id} — « ${doc.title || doc.code || doc.id} » (${facts.join(" · ")})`,
    ...(outline ? [`  Outline: ${outline}${more}`] : []),
    ...(shape.figures.length ? [`  Pictures: ${shape.figures.length}`] : []),
    ...(note ? [`  The team says: ${note.length > 400 ? `${note.slice(0, 400)}…` : note}`] : []),
  ];
}

const WORDS: Record<DocChange["change"], string> = {
  added: "added",
  converted: "converted again (or its details changed)",
  removed: "removed",
};

export const changeLines = (changes: DocChange[]) =>
  changes.map((c) => `- ${WORDS[c.change]}: ${c.id} — « ${c.title} »`);

// ponytail: no line when every document changed; the template of Settings › Context passes « {n} »
const othersLine = (others: number | string) =>
  others === 0
    ? []
    : [
        `The other ${others === 1 ? "document is" : `${others} documents are`} unchanged: their sections already say what they are. Read one (docs_show, rag_search) only when a link needs it.`,
        "",
      ];

export function overviewPrompt(
  mode: OverviewMode,
  language: string,
  changes: string[],
  documents: string[],
  others: number | string,
): string {
  const head = [
    `${OVERVIEW_MARKER} to ${mode === "full" ? "write" : "update"} ${OVERVIEW_PATH}: how this project's documents fit together.`,
    `Write it in the project's language (${language}). Do not touch its frontmatter (between the --- lines): Testimus writes it.`,
  ];
  if (mode === "full")
    return [
      ...head,
      `Write it whole, from scratch, with Write (replace what is there): a section per document, then the sections across them.`,
      "",
      "The documents:",
      ...documents,
      "",
      "When finished, reply in 2-4 lines: the sections you wrote.",
      "",
    ].join("\n");
  return [
    ...head,
    `It exists: Read it first, then change it in place with Edit — never rewrite it whole. Change only:`,
    "- the section of each document listed below: add the section of a document added, bring up to date the section of a document converted again, delete the section of a document removed;",
    "- the sections across the documents (the corpus, the links, the amendments, what contradicts) where these changes touch them.",
    "Keep every other line word for word: the sections of the documents that did not change, and whatever the team wrote by hand (merge into it, never drop it).",
    "",
    "What changed since the last update:",
    ...changes,
    "",
    "The documents that changed:",
    ...documents,
    "",
    ...othersLine(others),
    "When finished, reply in 2-4 lines: the sections you changed, added or removed.",
    "",
  ].join("\n");
}

export const prompts: PromptTemplate[] = [
  {
    id: "overview-update",
    name: "Update how the documents fit together",
    group: "Documents",
    usedBy: ["Documents: after an import or a conversion (when on)", "How the documents fit together: Update now"],
    text: () =>
      overviewPrompt(
        "auto",
        "{language}",
        ["{what changed: added, converted again, removed}"],
        ["{documents}"],
        "{n}",
      ).trim(),
  },
  {
    id: "overview-full",
    name: "Write how the documents fit together, from scratch",
    group: "Documents",
    usedBy: ["How the documents fit together: Rewrite from scratch", "the first update of a project"],
    text: () => overviewPrompt("full", "{language}", [], ["{documents}"], 0).trim(),
  },
  {
    id: "overview-line",
    name: "How the documents fit together, in every run",
    group: "Every run",
    usedBy: [
      "Added at the end of every run's prompt while « Give it to every Claude run » is on (not figure, header or picture reading)",
    ],
    text: () => OVERVIEW_LINE,
  },
];

export type OverviewResult = {
  ran: boolean;
  mode: OverviewMode;
  changes: DocChange[];
  sections: SectionChanges;
  warnings: string[];
  summary: string;
  runId?: string;
};

const NONE: SectionChanges = { modified: [], added: [], removed: [] };

const KIND_OF: Record<DocChange["change"], OverviewKind> = {
  added: "import",
  converted: "conversion",
  removed: "removal",
};
const SAID: Record<OverviewKind, string> = {
  import: "Import of",
  conversion: "Conversion of",
  removal: "Removal of",
  rewrite: "A rewrite from scratch",
  first: "Its first writing",
};

// ponytail: what an update is said to come after (updatedAfter, the person's words) and its kind (what the page reads);
// changes of several sorts have no kind
export function afterOf(asked: OverviewMode, mode: OverviewMode, changes: DocChange[]) {
  if (asked === "full") return { updatedAfter: SAID.rewrite, kind: "rewrite" as const };
  if (mode === "full") return { updatedAfter: SAID.first, kind: "first" as const };
  const one = changes.length === 1 ? ` « ${changes[0].title} »` : ` ${changes.length} documents`;
  const sorts = new Set(changes.map((c) => c.change));
  const kind = sorts.size === 1 ? KIND_OF[changes[0].change] : undefined;
  return kind ? { updatedAfter: `${SAID[kind]}${one}`, kind } : { updatedAfter: `Changes to${one}` };
}

export const overviewOff = () =>
  new UserError(
    "How the documents fit together is off for this project.",
    "Turn it on in Settings › Claude (or on its page in Documents), then update it.",
    "overview-off",
  );

export async function writeOverviewRun(
  ctx: Ctx,
  project: string,
  input: { mode: OverviewMode } & JobRun,
): Promise<OverviewResult> {
  if (!overviewOption(project).enabled) {
    if (input.mode === "full") throw overviewOff();
    ctx.log("info", "How the documents fit together was turned off meanwhile: no update.");
    return { ran: false, mode: input.mode, changes: [], sections: NONE, warnings: [], summary: "Turned off." };
  }
  const before = readOverview(project);
  const mode: OverviewMode = before.exists && before.body.trim() ? input.mode : "full";
  if (mode !== input.mode) ctx.log("info", "There is no overview yet: Claude writes it whole.");
  const now = basisOf(project);
  const changes = changesSince(project, before.meta.basis, now);
  if (mode === "auto" && !changes.length) {
    ctx.log("info", "No document changed since the last update: nothing to do.");
    return { ran: false, mode, changes, sections: NONE, warnings: [], summary: "Nothing changed." };
  }
  if (!docIds(project).length && mode === "full")
    throw new UserError("The project has no document yet.", "Add documents first, then update the overview.");
  const p = readProject(project);
  const touched = mode === "full" ? docIds(project) : changes.filter((c) => c.change !== "removed").map((c) => c.id);
  const documents = touched.flatMap((id) => docSummary(project, readDoc(project, id)));
  const others = Object.keys(now).length - touched.length;
  ctx.progress({ message: mode === "full" ? "Claude writes the overview" : "Claude updates the overview" });
  const kept = keepForOverview(project);
  const r = await runClaude({
    kind: "overview",
    project,
    prompt: overviewPrompt(mode, p.language, changeLines(changes), documents, others),
    model: input.model || p.claude.model,
    effort: input.effort || "medium",
    label: "overview",
    title: "How the documents fit together",
    ...(ctx.jobId ? { jobId: ctx.jobId } : {}),
    signal: ctx.signal,
    onEvent: (e) => ctx.claude(e),
  });
  const strays = strayWrites(project, r.calls);
  if (strays.length) {
    const left = undoWrites(project, kept, [...strays, OVERVIEW_PATH]);
    const undone = strays.filter((s) => !left.includes(s));
    throw new UserError(
      `Claude wrote outside ${OVERVIEW_PATH}: ${strays.join(", ")}. ${undone.length ? `Put back as it was: ${undone.join(", ")}. ` : ""}${left.length ? `Left as Claude wrote it: ${left.join(", ")}. ` : ""}${OVERVIEW_PATH} was not updated.`,
      "Update it again; the run may write that file only.",
      "overview-outside",
    );
  }
  if (!r.ok) throw new UserError(`Claude did not ${mode === "full" ? "write" : "update"} the overview: ${r.summary}`);
  const after = readOverview(project);
  if (!after.body.trim())
    throw new UserError(
      `Claude left ${OVERVIEW_PATH} empty${r.summary.trim() ? `: ${r.summary.trim()}` : "."}`,
      "Update it again.",
    );
  const was = sectionsOf(before.body);
  const is = sectionsOf(after.body);
  const warnings = mode === "auto" ? overviewWarnings(was, is, changes) : [];
  for (const w of warnings) ctx.log("warn", w);
  const sections = sectionDiff(was, is);
  const at = env.now().toISOString();
  writeOverview(project, { updatedAt: at, ...afterOf(input.mode, mode, changes), basis: now, ...sections }, after.body);
  keepLastUpdate(project, at, before.body, after.body);
  return { ran: true, mode, changes, sections, warnings, summary: r.summary, runId: r.runId };
}
