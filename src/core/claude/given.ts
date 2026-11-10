import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../command.ts";
import { listContexts } from "../lib/contexts.ts";
import { docIds, findDoc, isConverted, privateDocs, readContext, readDoc } from "../lib/docs.ts";
import { OVERVIEW_PATH, overviewGiven } from "../lib/overview.ts";
import { readProject } from "../lib/project.ts";
import { readLocal, readTest, testExists } from "../lib/store.ts";
import type { ClaudeScope } from "../types.ts";
import type { RunKind } from "./access.ts";
import { contextDir, readContexts } from "./prompt.ts";

// ponytail: what a Claude run is given besides its own instruction — decided here, once, for every kind of run: the
// page that shows a request before it is sent (claude.preview), Settings › Context and the run itself read the same
// pieces, so what is shown is what is sent

/** what the run is about: it decides which contexts and which documents' notes go with it */
export type Subject =
  | { kind: "test"; testId: string }
  | { kind: "tests"; testIds: string[] }
  | { kind: "doc"; docId: string }
  | { kind: "project"; docs?: string[] }
  | { kind: "none" };

/** what the user chose for this run only */
export type Pick = {
  /** the saved contexts of this run, in place of the ones its subject attaches */
  contexts?: string[];
  /** pieces left out of this run: overview, context:<id>, doc:<id>, docnote:<id> */
  without?: string[];
  note?: string;
  conversation?: string;
};

export type PieceKind =
  | "instruction"
  | "skill"
  | "rules"
  | "tools"
  | "overview"
  | "context"
  | "document"
  | "docnote"
  | "note"
  | "conversation";

/** inline: said in full in the prompt · pointer: Claude is told where to read it · auto: Claude Code loads it by
 * itself · search: Claude finds passages in it with the search tools */
export type PieceHow = "inline" | "pointer" | "auto" | "search";

export type Piece = {
  id: string;
  kind: PieceKind;
  name: string;
  why: string;
  how: PieceHow;
  locked: boolean;
  on: boolean;
  chars: number;
  path?: string;
  parent?: string;
  detail?: string;
  text?: string;
};

export type Given = {
  pieces: Piece[];
  lines: string[];
  contexts: string[];
  withoutDocs: string[];
};

export const INLINE_NOTES = 4000;
export const INLINE_DOC_NOTE = 3000;

// ponytail: a run that only looks at pictures or passages of one document (figures, headers, media), or that writes the
// overview itself, is not told to read how the documents fit together
const NO_OVERVIEW: RunKind[] = ["overview", "figures", "headers", "media"];
// ponytail: the runs that search the documents list them, and a document can be left out of one run; a run on one
// document's own files (figures, headers, media, study, overview) does not search
const SEARCHES: RunKind[] = ["chat", "check", "analyze", "generate", "fix", "run", "triage", "action", "columns"];

export const takesOf = (kind: RunKind): { overview: boolean; documents: boolean } => ({
  overview: !NO_OVERVIEW.includes(kind),
  documents: SEARCHES.includes(kind),
});

export function subjectOf(scope: ClaudeScope): Subject {
  if (scope.kind === "step" || scope.kind === "test") return { kind: "test", testId: scope.testId };
  if (scope.kind === "tests") return { kind: "tests", testIds: scope.testIds };
  if (scope.kind === "doc") return { kind: "doc", docId: scope.docId };
  return { kind: "project" };
}

type Attached = { id: string; why: string };

const DEFAULT = "A default of the project";
const ID = /^[\w-]+$/;

function ownOfTests(project: string): Attached[] {
  const dir = join(project, "tests");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .flatMap((t) => (readLocal(project, t).contexts ?? []).map((id) => ({ id, why: `Attached to the test ${t}` })));
}

// ponytail: the one rule — a run reads the contexts of what it is about: a test's own list or a document's own list
// when it has one, else the project's defaults; several tests, each one's; the whole project, the defaults and every
// test's own list. What the user picks for one run replaces it
export function attachedContexts(project: string, subject: Subject): Attached[] {
  const defaults = readProject(project).claude.contexts.map((id) => ({ id, why: DEFAULT }));
  const ofTest = (t: string): Attached[] => {
    const own = testExists(project, t) ? readLocal(project, t).contexts : undefined;
    return own ? own.map((id) => ({ id, why: `Attached to the test ${t}` })) : defaults;
  };
  let all = defaults;
  if (subject.kind === "test") all = ofTest(subject.testId);
  if (subject.kind === "tests") all = subject.testIds.flatMap(ofTest);
  if (subject.kind === "doc") {
    const own = findDoc(project, subject.docId)?.contexts;
    if (Array.isArray(own))
      all = own
        .filter((x): x is string => typeof x === "string")
        .map((id) => ({ id, why: `Attached to the document ${subject.docId}` }));
  }
  if (subject.kind === "project") all = [...defaults, ...ownOfTests(project)];
  const seen = new Set<string>();
  return all.filter((a) => {
    if (seen.has(a.id) || !ID.test(a.id) || !existsSync(contextDir(project, a.id))) return false;
    seen.add(a.id);
    return true;
  });
}

function citedDocs(project: string, tests: string[]): string[] {
  const byCode = new Map<string, string>();
  for (const id of docIds(project)) {
    byCode.set(id, id);
    const code = readDoc(project, id).code;
    if (code && !byCode.has(code)) byCode.set(code, id);
  }
  const out = new Set<string>();
  for (const t of tests) {
    if (!testExists(project, t)) continue;
    for (const s of readTest(project, t).test.steps)
      for (const x of s.sources) {
        const id = byCode.get(x.docId);
        if (id) out.add(id);
      }
  }
  return [...out].sort();
}

function aboutDocs(project: string, subject: Subject): string[] {
  if (subject.kind === "test") return citedDocs(project, [subject.testId]);
  if (subject.kind === "tests") return citedDocs(project, subject.testIds);
  if (subject.kind === "doc") return findDoc(project, subject.docId) ? [subject.docId] : [];
  if (subject.kind === "project") return (subject.docs ?? []).filter((d) => findDoc(project, d));
  return [];
}

const slash = (p: string) => p.replace(/\\/g, "/");

export type GivenText = {
  overview: boolean;
  contexts: { name: string; dir: string; notes: string; inline: boolean; files: string[]; paths: string[] }[];
  docNotes: { id: string; note: string; inline: boolean }[];
  without: string[];
  note: string;
  conversation: string;
};

// ponytail: the block every prompt carries after its instruction, in one order — what to read first, what the team
// says about the documents of the run, what is left out, then the user's own words for this run
export function givenText(g: GivenText): string[] {
  const lines: string[] = [];
  const read: string[] = [];
  if (g.overview)
    read.push(
      `- ${OVERVIEW_PATH} — how the project's documents fit together. Background written by Claude, never a source: cite the documents.`,
    );
  for (const c of g.contexts) {
    const parts: string[] = [];
    if (c.notes.trim()) parts.push(c.inline ? "its notes are below" : `notes: ${c.dir}/context.md`);
    if (c.files.length) parts.push(`files: ${c.files.map((f) => `${c.dir}/files/${f}`).join(", ")}`);
    if (c.paths.length) parts.push(`also look at: ${c.paths.join(", ")}`);
    read.push(`- « ${c.name} »${parts.length ? ` — ${parts.join("; ")}` : ""}`);
  }
  if (read.length) lines.push("", "Read first — reference material, never edit it:", ...read);
  for (const c of g.contexts) if (c.inline && c.notes.trim()) lines.push("", `« ${c.name} »:`, c.notes.trim());
  if (g.docNotes.length)
    lines.push(
      "",
      "What the team knows about the documents of this run:",
      ...g.docNotes.map((d) => (d.inline ? `- ${d.id}: ${d.note.trim()}` : `- ${d.id}: read docs/${d.id}/context.md`)),
    );
  if (g.without.length) lines.push("", `Left out of this run — never search, read or cite: ${g.without.join(", ")}.`);
  if (g.note.trim()) lines.push("", "From the user, for this run only:", g.note.trim());
  if (g.conversation.trim())
    lines.push(
      "",
      "Earlier in this conversation (background; the request below is what to do now):",
      g.conversation.trim(),
    );
  return lines;
}

export const GIVEN_SLOT = ["", "{what goes with the run: see « What goes with a run »}"];

export const givenTemplate = (): string =>
  givenText({
    overview: true,
    contexts: [
      { name: "{context}", dir: "{its folder}", notes: "{its notes}", inline: true, files: ["{file}"], paths: [] },
      {
        name: "{context with long notes}",
        dir: "{its folder}",
        notes: "x",
        inline: false,
        files: [],
        paths: ["{outside path}"],
      },
    ],
    docNotes: [{ id: "{document}", note: "{what the team wrote about it}", inline: true }],
    without: ["{document left out}"],
    note: "{note}",
    conversation: "{conversation}",
  })
    .join("\n")
    .trim();

// ponytail: a job on a document (its figures, its conversion check, its warnings) — the contexts the job names for this
// run go on top of the document's own
export function docGiven(
  project: string,
  kind: RunKind,
  docId: string,
  run: { note?: string; contexts?: string[]; without?: string[] } = {},
): Given {
  const subject: Subject = { kind: "doc", docId };
  if (privateDocs(project).includes(docId))
    throw new UserError(
      `${docId} is never given to Claude.`,
      "The team keeps this document from Claude (Documents › the document › Never to Claude).",
      "doc-private",
    );
  const own = attachedContexts(project, subject).map((a) => a.id);
  return given(project, kind, subject, {
    note: run.note,
    without: run.without,
    ...(run.contexts?.length ? { contexts: [...new Set([...own, ...run.contexts])] } : {}),
  });
}

export function given(project: string, kind: RunKind, subject: Subject, pick: Pick = {}): Given {
  const off = new Set(pick.without ?? []);
  const pieces: Piece[] = [];

  const overview = !NO_OVERVIEW.includes(kind) && overviewGiven(project);
  if (overview)
    pieces.push({
      id: "overview",
      kind: "overview",
      name: "How the documents fit together",
      why: "Settings › Claude: given to every Claude run",
      how: "pointer",
      locked: false,
      on: !off.has("overview"),
      chars: 0,
      path: OVERVIEW_PATH,
    });

  const attached = attachedContexts(project, subject);
  const why = new Map(attached.map((a) => [a.id, a.why]));
  const asked = pick.contexts?.filter((id) => ID.test(id) && existsSync(contextDir(project, id)));
  const chosen = [...new Set(asked ?? attached.map((a) => a.id))].filter((id) => !off.has(`context:${id}`));
  const known = listContexts(project);
  const shown = [...chosen, ...known.map((c) => c.id).filter((id) => !chosen.includes(id))];
  const texts: GivenText["contexts"] = [];
  for (const c of readContexts(project, shown)) {
    const on = chosen.includes(c.id);
    const inline = c.text.trim().length <= INLINE_NOTES;
    const dir = slash(contextDir(project, c.id));
    const detail = [
      c.files.length ? `${c.files.length} file${c.files.length === 1 ? "" : "s"}: ${c.files.join(", ")}` : "",
      c.paths.length ? `also: ${c.paths.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    pieces.push({
      id: `context:${c.id}`,
      kind: "context",
      name: c.name,
      why: why.get(c.id) ?? (on ? "Chosen for this run" : "Saved, not attached to this run"),
      how: inline && !c.files.length && !c.paths.length ? "inline" : "pointer",
      locked: false,
      on,
      chars: c.text.trim().length,
      path: `${dir}/context.md`,
      ...(detail ? { detail } : {}),
      ...(c.text.trim() ? { text: c.text.trim() } : {}),
    });
    if (on) texts.push({ name: c.name, dir, notes: c.text, inline, files: c.files, paths: c.paths });
  }

  const about = aboutDocs(project, subject);
  const searches = SEARCHES.includes(kind);
  const docs = searches
    ? docIds(project)
        .map((id) => readDoc(project, id))
        .filter(isConverted)
    : about.map((id) => readDoc(project, id));
  const order = [...docs.filter((d) => about.includes(d.id)), ...docs.filter((d) => !about.includes(d.id))];
  const docNotes: GivenText["docNotes"] = [];
  const withoutDocs: string[] = [];
  for (const d of order) {
    const isAbout = about.includes(d.id);
    const docOn = !d.private && (!searches || !off.has(`doc:${d.id}`));
    if (searches)
      pieces.push({
        id: `doc:${d.id}`,
        kind: "document",
        name: d.title || d.code || d.id,
        why: d.private
          ? "Never given to Claude: the document's own setting"
          : isAbout
            ? "A document of this run"
            : "A document of the project: Claude may search it",
        how: "search",
        locked: !!d.private,
        on: docOn,
        chars: d.converted?.stats?.chars ?? 0,
        path: `docs/${d.id}/doc.md`,
        detail: [d.id, d.version ? `v${d.version}` : "", d.status].filter(Boolean).join(" · "),
      });
    if (!docOn) withoutDocs.push(d.id);
    const note = readContext(project, d.id).trim();
    if (!note) continue;
    const noteOn = docOn && isAbout && !off.has(`docnote:${d.id}`);
    const inline = note.length <= INLINE_DOC_NOTE;
    pieces.push({
      id: `docnote:${d.id}`,
      kind: "docnote",
      name: `What the team knows about ${d.id}`,
      why: isAbout ? "The run is about this document" : "Read by Claude when it uses the document (docs_show)",
      how: isAbout ? (inline ? "inline" : "pointer") : "search",
      locked: !isAbout,
      on: isAbout ? noteOn : docOn,
      chars: note.length,
      path: `docs/${d.id}/context.md`,
      ...(searches ? { parent: `doc:${d.id}` } : {}),
      text: note,
    });
    if (noteOn) docNotes.push({ id: d.id, note, inline });
  }

  const note = pick.note?.trim() ?? "";
  if (note)
    pieces.push({
      id: "note",
      kind: "note",
      name: "Your note for this run",
      why: "Written in the box for this run only",
      how: "inline",
      locked: true,
      on: true,
      chars: note.length,
      text: note,
    });
  const conversation = pick.conversation?.trim() ?? "";
  if (conversation)
    pieces.push({
      id: "conversation",
      kind: "conversation",
      name: "The conversation so far",
      why: "The exchanges of the Claude panel not cleared yet",
      how: "inline",
      locked: true,
      on: true,
      chars: conversation.length,
      text: conversation,
    });

  const lines = givenText({
    overview: overview && !off.has("overview"),
    contexts: texts,
    docNotes,
    without: withoutDocs,
    note,
    conversation,
  });
  return { pieces, lines, contexts: chosen, withoutDocs };
}
