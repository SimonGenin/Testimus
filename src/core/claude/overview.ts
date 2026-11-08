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

export function overviewPrompt(
  mode: OverviewMode,
  language: string,
  changes: string[],
  documents: string[],
  others: number,
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
    `The other ${others === 1 ? "document is" : `${others} documents are`} unchanged: their sections already say what they are. Read one (docs_show, rag_search) only when a link needs it.`,
    "",
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
      overviewPrompt("auto", "{language}", ["{what changed: added, converted again, removed}"], ["{documents}"], 0)
        .replace("The other document is", "The other {n} documents are")
        .trim(),
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

// ponytail: what an update is said to come after — the import or conversion that asked for it, else what changed
export function reasonOf(changes: DocChange[]): string {
  const n = (k: DocChange["change"]) => changes.filter((c) => c.change === k).length;
  const one = changes.length === 1 ? ` « ${changes[0].title} »` : ` ${changes.length} documents`;
  if (!changes.length) return "An update asked for";
  if (n("added") === changes.length) return `Import of${one}`;
  if (n("converted") === changes.length) return `Conversion of${one}`;
  if (n("removed") === changes.length) return `Removal of${one}`;
  return `Changes to${one}`;
}

export async function writeOverviewRun(
  ctx: Ctx,
  project: string,
  input: { mode: OverviewMode; reason?: string } & JobRun,
): Promise<OverviewResult> {
  if (!overviewOption(project).enabled)
    throw new UserError(
      "How the documents fit together is off for this project.",
      "Turn it on in Settings › Claude (or on its page in Documents), then update it.",
      "overview-off",
    );
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
  if (!r.ok) throw new UserError(`Claude did not ${mode === "full" ? "write" : "update"} the overview: ${r.summary}`);
  const after = readOverview(project);
  if (!after.body.trim()) throw new UserError(`Claude left ${OVERVIEW_PATH} empty.`, "Update it again.");
  const was = sectionsOf(before.body);
  const is = sectionsOf(after.body);
  const warnings = mode === "auto" ? overviewWarnings(was, is, changes) : [];
  for (const w of warnings) ctx.log("warn", w);
  const sections = sectionDiff(was, is);
  writeOverview(
    project,
    {
      updatedAt: env.now().toISOString(),
      updatedAfter:
        input.reason ||
        (input.mode === "full" ? "A rewrite from scratch" : mode === "full" ? "Its first writing" : reasonOf(changes)),
      basis: now,
      ...sections,
    },
    after.body,
  );
  keepLastUpdate(project, before.body, after.body);
  return { ran: true, mode, changes, sections, warnings, summary: r.summary, runId: r.runId };
}
