import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  attachedContexts,
  docGiven,
  given,
  givenText,
  INLINE_DOC_NOTE,
  INLINE_NOTES,
  type Piece,
  subjectOf,
  takesOf,
} from "../../../../src/core/claude/given.ts";
import { contextDir, writeDocContexts, writeTestContexts } from "../../../../src/core/claude/prompt.ts";
import { writeContext } from "../../../../src/core/lib/docs.ts";
import { readProject, writeProject } from "../../../../src/core/lib/project.ts";
import { writeContextMd } from "../../helpers/context.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const DOC = "SOSIE_211_D401-1_3";
const OTHER = "SOSIE_211_D401-1_4";
const PHOTOS = "RECETTE_TCO_12-10";
const TEST = "LFRPS12-1420";
const NOTE =
  "Document de référence pour la traction de la ligne 92. La version 01.01 remplace la 01.00 ; les sectionneurs avec TK ne sont pas encore câblés dans le simulateur.";

let dir: string;

const context = (id: string, c: { name?: string; paths?: string[]; notes?: string }, files: string[] = []) => {
  const d = contextDir(dir, id);
  writeContextMd(d, c);
  if (files.length) mkdirSync(join(d, "files"), { recursive: true });
  for (const f of files) writeFileSync(join(d, "files", f), "");
};

const defaults = (ids: string[]) => {
  const p = readProject(dir);
  writeProject(dir, { ...p, claude: { ...p.claude, contexts: ids } });
};

const overviewOn = () => {
  writeFileSync(join(dir, "docs", "OVERVIEW.md"), "---\nbasis:\n---\n## Traction\n");
  const p = readProject(dir);
  writeProject(dir, { ...p, claude: { ...p.claude, overview: { enabled: true, inEveryRun: true } } });
};

const piece = (pieces: Piece[], id: string) => pieces.find((p) => p.id === id);
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-given-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  context("glossary", { name: "RATP glossary", notes: "TCO: poste de commande." });
  context("style", { name: "House style", notes: "One gesture per step." });
  context("plans", { name: "Plans", paths: ["D:/plans"], notes: "Les plans de voie." }, ["p.pdf"]);
});

afterEach(() => {
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("the one rule for contexts: a run reads the contexts of what it is about", () => {
  it("a test's own list when it has one — an empty one too — else the project's defaults", () => {
    defaults(["glossary", "gone", "bad id"]);
    expect(attachedContexts(dir, { kind: "test", testId: TEST })).toEqual([
      { id: "glossary", why: "A default of the project" },
    ]);
    writeTestContexts(dir, TEST, ["style", "gone"]);
    expect(attachedContexts(dir, { kind: "test", testId: TEST })).toEqual([
      { id: "style", why: `Attached to the test ${TEST}` },
    ]);
    writeTestContexts(dir, TEST, []);
    expect(attachedContexts(dir, { kind: "test", testId: TEST })).toEqual([]);
    expect(ids(attachedContexts(dir, { kind: "test", testId: "local-00000000" }))).toEqual(["glossary"]);
  });

  it("several tests: each one's, once; a document: its own list, else the defaults", () => {
    defaults(["glossary"]);
    writeTestContexts(dir, TEST, ["style", "glossary"]);
    expect(ids(attachedContexts(dir, { kind: "tests", testIds: [TEST, "LFRPS12-1398"] }))).toEqual([
      "style",
      "glossary",
    ]);
    expect(ids(attachedContexts(dir, { kind: "doc", docId: DOC }))).toEqual(["glossary"]);
    writeDocContexts(dir, DOC, ["plans", "plans"]);
    expect(attachedContexts(dir, { kind: "doc", docId: DOC })).toEqual([
      { id: "plans", why: `Attached to the document ${DOC}` },
    ]);
    writeDocContexts(dir, DOC, []);
    expect(attachedContexts(dir, { kind: "doc", docId: DOC })).toEqual([]);
  });

  it("the whole project: the defaults and every test's own list, each once; nothing in particular: the defaults", () => {
    defaults(["glossary"]);
    writeTestContexts(dir, TEST, ["style", "glossary", "plans"]);
    writeTestContexts(dir, "LFRPS12-1398", ["plans"]);
    expect(attachedContexts(dir, { kind: "project" })).toEqual([
      { id: "glossary", why: "A default of the project" },
      { id: "plans", why: "Attached to the test LFRPS12-1398" },
      { id: "style", why: `Attached to the test ${TEST}` },
    ]);
    expect(ids(attachedContexts(dir, { kind: "none" }))).toEqual(["glossary"]);
    rmSync(join(dir, "tests"), { recursive: true, force: true });
    expect(ids(attachedContexts(dir, { kind: "project" }))).toEqual(["glossary"]);
  });

  it("what the user picks for one run replaces it; the other saved contexts are shown, off", () => {
    defaults(["glossary"]);
    const own = given(dir, "run", { kind: "test", testId: TEST });
    expect(own.contexts).toEqual(["glossary"]);
    expect(piece(own.pieces, "context:glossary")).toMatchObject({ on: true, why: "A default of the project" });
    expect(piece(own.pieces, "context:style")).toMatchObject({ on: false, why: "Saved, not attached to this run" });

    const picked = given(dir, "run", { kind: "test", testId: TEST }, { contexts: ["style", "gone", "../x", "style"] });
    expect(picked.contexts).toEqual(["style"]);
    expect(piece(picked.pieces, "context:style")).toMatchObject({ on: true, why: "Chosen for this run" });
    expect(piece(picked.pieces, "context:glossary")?.on).toBe(false);
    expect(picked.lines.join("\n")).not.toContain("RATP glossary");
    expect(given(dir, "run", { kind: "test", testId: TEST }, { contexts: [] }).contexts).toEqual([]);
  });

  it("a scope of claude.run names its subject; a step is its test, a test run nothing but the project", () => {
    expect(subjectOf({ kind: "step", testId: TEST, step: 2 })).toEqual({ kind: "test", testId: TEST });
    expect(subjectOf({ kind: "tests", testIds: [TEST] })).toEqual({ kind: "tests", testIds: [TEST] });
    expect(subjectOf({ kind: "doc", docId: DOC })).toEqual({ kind: "doc", docId: DOC });
    expect(subjectOf({ kind: "run", run: "recette-j5" })).toEqual({ kind: "project" });
  });
});

describe("how a context is said", () => {
  it("notes of 4 000 characters at most are said in full; longer ones are pointed at", () => {
    const fits = "a".repeat(INLINE_NOTES);
    const long = "b".repeat(INLINE_NOTES + 1);
    context("fits", { name: "Fits", notes: `${fits}\n` });
    context("long", { name: "Long", notes: long });
    const g = given(dir, "chat", { kind: "none" }, { contexts: ["fits", "long"] });
    const text = g.lines.join("\n");
    const at = `${dir.replace(/\\/g, "/")}/contexts`;
    expect(text).toContain("\n- « Fits » — its notes are below\n");
    expect(text).toContain(`\n- « Long » — notes: ${at}/long/context.md\n`);
    expect(text).toContain(`\n\n« Fits »:\n${fits}`);
    expect(text).not.toContain("« Long »:");
    expect(text).not.toContain(long);
    expect(piece(g.pieces, "context:fits")).toMatchObject({ how: "inline", chars: INLINE_NOTES, text: fits });
    expect(piece(g.pieces, "context:long")).toMatchObject({ how: "pointer", chars: INLINE_NOTES + 1 });
  });

  it("its files and outside paths are pointed at beside its notes; a context without notes is only named", () => {
    context("empty", { name: "Empty", notes: "  " });
    const g = given(dir, "chat", { kind: "none" }, { contexts: ["plans", "empty"] });
    const at = `${dir.replace(/\\/g, "/")}/contexts`;
    expect(g.lines).toEqual([
      "",
      "Read first — reference material, never edit it:",
      `- « Plans » — its notes are below; files: ${at}/plans/files/p.pdf; also look at: D:/plans`,
      "- « Empty »",
      "",
      "« Plans »:",
      "Les plans de voie.",
    ]);
    expect(piece(g.pieces, "context:plans")).toMatchObject({
      how: "pointer",
      detail: "1 file: p.pdf · also: D:/plans",
      path: `${at}/plans/context.md`,
    });
    expect(piece(g.pieces, "context:empty")).toMatchObject({ how: "inline", chars: 0 });
    expect(piece(g.pieces, "context:empty")?.text).toBeUndefined();
  });
});

describe("the documents of a run and what the team wrote about them", () => {
  it("a document's context.md is said in full for the documents the run is about, and only for them", () => {
    const g = given(dir, "check", { kind: "test", testId: TEST });
    expect(g.lines).toEqual(["", "What the team knows about the documents of this run:", `- ${DOC}: ${NOTE}`]);
    expect(piece(g.pieces, `docnote:${DOC}`)).toMatchObject({
      kind: "docnote",
      how: "inline",
      locked: false,
      on: true,
      parent: `doc:${DOC}`,
      path: `docs/${DOC}/context.md`,
      why: "The run is about this document",
      text: NOTE,
    });
    expect(piece(g.pieces, `docnote:${PHOTOS}`)).toMatchObject({
      how: "search",
      locked: true,
      on: true,
      why: "Read by Claude when it uses the document (docs_show)",
    });
    expect(piece(g.pieces, `docnote:${OTHER}`)).toBeUndefined();
    expect(g.lines.join("\n")).not.toContain("Photos du TCO");
  });

  it("the documents a generation has in scope are the ones it is about; a note too long is pointed at", () => {
    writeContext(dir, OTHER, "c".repeat(INLINE_DOC_NOTE + 1));
    const g = given(dir, "generate", { kind: "project", docs: [DOC, OTHER, "NOPE"] });
    expect(g.lines).toEqual([
      "",
      "What the team knows about the documents of this run:",
      `- ${DOC}: ${NOTE}`,
      `- ${OTHER}: read docs/${OTHER}/context.md`,
    ]);
    expect(piece(g.pieces, `docnote:${OTHER}`)).toMatchObject({ how: "pointer", chars: INLINE_DOC_NOTE + 1 });
    expect(given(dir, "generate", { kind: "project" }).lines).toEqual([]);
  });

  it("a run that searches lists every converted document, the ones it is about first", () => {
    const g = given(dir, "check", { kind: "test", testId: TEST });
    const docs = g.pieces.filter((p) => p.kind === "document");
    expect(docs[0]).toMatchObject({
      id: `doc:${DOC}`,
      name: "Traction",
      how: "search",
      locked: false,
      on: true,
      why: "A document of this run",
      path: `docs/${DOC}/doc.md`,
      detail: `${DOC} · v01.01 · validated`,
    });
    expect(docs.length).toBeGreaterThan(1);
    for (const d of docs.slice(1)) expect(d.why).toBe("A document of the project: Claude may search it");
    expect(g.withoutDocs).toEqual([]);
  });

  it("a job on one document's own files lists no document to search, and still says its note", () => {
    const g = docGiven(dir, "figures", DOC);
    expect(g.pieces.filter((p) => p.kind === "document")).toEqual([]);
    expect(piece(g.pieces, `docnote:${DOC}`)).toMatchObject({ how: "inline", on: true, locked: false });
    expect(piece(g.pieces, `docnote:${DOC}`)?.parent).toBeUndefined();
    expect(g.lines).toEqual(["", "What the team knows about the documents of this run:", `- ${DOC}: ${NOTE}`]);
  });

  it("the contexts a document job names go on top of the document's own", () => {
    defaults(["glossary"]);
    expect(docGiven(dir, "study", DOC).contexts).toEqual(["glossary"]);
    expect(docGiven(dir, "study", DOC, { contexts: ["style"] }).contexts).toEqual(["glossary", "style"]);
    writeDocContexts(dir, DOC, ["plans"]);
    expect(docGiven(dir, "study", DOC, { contexts: ["style", "plans"], note: "Regarde la figure 41." })).toMatchObject({
      contexts: ["plans", "style"],
    });
    expect(docGiven(dir, "study", DOC, { note: "Regarde la figure 41." }).lines.slice(-2)).toEqual([
      "From the user, for this run only:",
      "Regarde la figure 41.",
    ]);
  });
});

describe("what a run may leave out, and what it may not", () => {
  it("without takes a context, a document, a document's note and the overview out of the run", () => {
    overviewOn();
    defaults(["glossary", "style"]);
    const all = given(dir, "check", { kind: "test", testId: TEST });
    expect(all.lines.join("\n")).toContain(
      "- docs/OVERVIEW.md — how the project's documents fit together. Background written by Claude, never a source: cite the documents.",
    );
    expect(piece(all.pieces, "overview")).toMatchObject({ how: "pointer", locked: false, on: true });

    const g = given(
      dir,
      "check",
      { kind: "test", testId: TEST },
      { without: ["overview", "context:style", `doc:${PHOTOS}`, `docnote:${DOC}`] },
    );
    expect(g.contexts).toEqual(["glossary"]);
    expect(g.withoutDocs).toEqual([PHOTOS]);
    expect(piece(g.pieces, "overview")?.on).toBe(false);
    expect(piece(g.pieces, "context:style")?.on).toBe(false);
    expect(piece(g.pieces, `doc:${PHOTOS}`)?.on).toBe(false);
    expect(piece(g.pieces, `docnote:${PHOTOS}`)?.on).toBe(false);
    expect(piece(g.pieces, `doc:${DOC}`)?.on).toBe(true);
    expect(piece(g.pieces, `docnote:${DOC}`)?.on).toBe(false);
    expect(g.lines).toEqual([
      "",
      "Read first — reference material, never edit it:",
      "- « RATP glossary » — its notes are below",
      "",
      "« RATP glossary »:",
      "TCO: poste de commande.",
      "",
      `Left out of this run — never search, read or cite: ${PHOTOS}.`,
    ]);
  });

  it("a document left out takes its note with it; a job on one document cannot leave that document out", () => {
    const g = given(dir, "check", { kind: "test", testId: TEST }, { without: [`doc:${DOC}`] });
    expect(g.withoutDocs).toEqual([DOC]);
    expect(piece(g.pieces, `docnote:${DOC}`)?.on).toBe(false);
    expect(g.lines).toEqual(["", `Left out of this run — never search, read or cite: ${DOC}.`]);
    const job = docGiven(dir, "study", DOC, { without: [`doc:${DOC}`] });
    expect(job.withoutDocs).toEqual([]);
    expect(job.lines.join("\n")).toContain(NOTE);
  });

  it("the user's own words are locked pieces, said last: the note, then the conversation", () => {
    const g = given(
      dir,
      "chat",
      { kind: "none" },
      { note: "  Réponds en une phrase.  ", conversation: "Q: Quel menu ?\nA: Propriétés.", without: ["note"] },
    );
    expect(piece(g.pieces, "note")).toMatchObject({
      kind: "note",
      how: "inline",
      locked: true,
      on: true,
      text: "Réponds en une phrase.",
      chars: 22,
    });
    expect(piece(g.pieces, "conversation")).toMatchObject({ kind: "conversation", locked: true, on: true });
    expect(g.lines).toEqual([
      "",
      "From the user, for this run only:",
      "Réponds en une phrase.",
      "",
      "Earlier in this conversation (background; the request below is what to do now):",
      "Q: Quel menu ?\nA: Propriétés.",
    ]);
    expect(g.pieces.filter((p) => p.locked).map((p) => p.kind)).toEqual(
      expect.arrayContaining(["note", "conversation"]),
    );
    for (const p of g.pieces.filter((x) => ["overview", "context", "document"].includes(x.kind)))
      expect(p.locked, p.id).toBe(false);
  });

  it("the overview is told to the runs that search or write, never to one that reads pictures or writes it", () => {
    overviewOn();
    for (const kind of ["chat", "check", "generate", "fix", "run", "action", "triage", "columns", "study"] as const)
      expect(piece(given(dir, kind, { kind: "none" }).pieces, "overview")?.on, kind).toBe(true);
    for (const kind of ["figures", "headers", "media", "overview"] as const) {
      expect(piece(given(dir, kind, { kind: "doc", docId: DOC }).pieces, "overview"), kind).toBeUndefined();
      expect(takesOf(kind).overview, kind).toBe(false);
    }
    expect(takesOf("check")).toEqual({ overview: true, documents: true });
    expect(takesOf("study")).toEqual({ overview: true, documents: false });
    const p = readProject(dir);
    writeProject(dir, { ...p, claude: { ...p.claude, overview: { enabled: true, inEveryRun: false } } });
    expect(piece(given(dir, "check", { kind: "none" }).pieces, "overview")).toBeUndefined();
  });
});

describe("the block every prompt carries", () => {
  it("is in one order: what to read first, the notes, the documents, what is left out, the note, the conversation", () => {
    const lines = givenText({
      overview: true,
      contexts: [{ name: "Glossary", dir: "C:/p/contexts/g", notes: "TCO.", inline: true, files: [], paths: [] }],
      docNotes: [{ id: "D1", note: "Version 2.", inline: true }],
      without: ["D2", "D3"],
      note: "Short.",
      conversation: "Q: x",
    });
    expect(lines).toEqual([
      "",
      "Read first — reference material, never edit it:",
      "- docs/OVERVIEW.md — how the project's documents fit together. Background written by Claude, never a source: cite the documents.",
      "- « Glossary » — its notes are below",
      "",
      "« Glossary »:",
      "TCO.",
      "",
      "What the team knows about the documents of this run:",
      "- D1: Version 2.",
      "",
      "Left out of this run — never search, read or cite: D2, D3.",
      "",
      "From the user, for this run only:",
      "Short.",
      "",
      "Earlier in this conversation (background; the request below is what to do now):",
      "Q: x",
    ]);
    expect(
      givenText({ overview: false, contexts: [], docNotes: [], without: [], note: " ", conversation: "" }),
    ).toEqual([]);
  });
});
