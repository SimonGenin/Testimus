import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { scope, throwIfAborted } from "../../shared/run/work.ts";
import { triage } from "../claude/actions.ts";
import { describeFigures, shouldDescribeFigures } from "../claude/figures.ts";
import { claudeHeaders } from "../claude/headers.ts";
import { docRunLines, type JobRun } from "../claude/prompt.ts";
import { claudeVersion } from "../claude/status.ts";
import { checkConversion, sameConversion, studyDoc } from "../claude/study.ts";
import { type Ctx, UserError } from "../command.ts";
import { startJob } from "../jobs.ts";
import { type IndexReport, indexProject } from "../rag/indexer.ts";
import { hintsOf, inspectDocx, inspectPdf } from "../rag/inspect.ts";
import type { CitingTest, DocConversion, DocJson, DocKind } from "../types.ts";
import { writeAtomic } from "./atomic.ts";
import { recheckMechanical, testsCiting } from "./check.ts";
import { docDir, readDoc, writeDoc } from "./docs.ts";
import { addDoc, convertedCopy, reconvertDoc, setConversion, twinOf } from "./docs-convert.ts";
import { conversionSlot, indexAfterConversions, whileConverting } from "./docs-index.ts";

// ponytail: the Claude runs a conversion starts are built by the modules it calls (tests/unit/core/claude/catalog.test.ts)
export const promptsUsed = ["figures", "triage"];

export type AfterConvert = { describeFigures?: boolean; triage?: boolean; study?: boolean; index?: boolean };
export type IndexOutcome = { chunks?: number; degraded?: string; error?: string };
export type Aftermath = { citedBy: CitingTest[]; index?: IndexOutcome };

export const runOf = (i: {
  model?: string;
  effort?: JobRun["effort"];
  note?: string;
  contexts?: string[];
}): JobRun => ({
  model: i.model,
  effort: i.effort,
  note: i.note,
  contexts: i.contexts,
});

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ponytail: the steps a conversion job shows, those that do not apply are skipped as it goes
export function convertSteps(first: { id: string; label: string }[], o: AfterConvert) {
  return [
    ...first,
    { id: "figures", label: "Describe the figures" },
    { id: "cited", label: "Re-check the tests citing it" },
    ...(o.study ? [] : [{ id: "triage", label: "Look at the conversion problems" }]),
    ...(o.index ? [{ id: "index", label: "Update the search index" }] : []),
  ];
}

async function withFigures(ctx: Ctx, project: string, doc: DocJson, claude: JobRun, on?: boolean): Promise<void> {
  if (!(on ?? shouldDescribeFigures(project)) || !doc.converted?.stats?.figures) return;
  ctx.step?.("figures");
  try {
    ctx.progress({ message: "Claude describes the figures" });
    await describeFigures(project, doc.id, ctx, claude);
  } catch (e) {
    ctx.log("warn", `Figure descriptions skipped: ${message(e)}`);
  }
}

// ponytail: the conversion warnings are shown to Claude with the import's own model and effort — it leaves a
// Claude action for those it can fix; without Claude on this PC, or when the look fails, the import goes on
async function withTriage(ctx: Ctx, project: string, doc: DocJson, claude: JobRun, on?: boolean): Promise<void> {
  const warnings = doc.converted?.warnings ?? [];
  if (!on || !warnings.length) return;
  ctx.step?.("triage");
  const probe = await claudeVersion();
  if (!probe.ok) {
    ctx.log("info", `Claude is not available here (${probe.text}): the conversion warnings are left as they are.`);
    return;
  }
  try {
    const problems = warnings.map((text) => ({ where: `doc:${doc.id}`, text }));
    const lines = docRunLines(project, doc.id, claude);
    await triage(ctx, project, problems, `the document ${doc.id}`, claude, "import", lines);
  } catch (e) {
    ctx.log("warn", `Claude did not look at the warnings: ${message(e)}`);
  }
}

// ponytail: the index run that follows a conversion is a job of its own under the conversion's step; it waits for
// the other conversions, and a failed run never undoes the conversion
export async function withIndex(ctx: Ctx, project: string, claude: JobRun): Promise<IndexOutcome> {
  ctx.step?.("index");
  const run = (signal: AbortSignal) => {
    throwIfAborted(signal);
    return startJob(
      "rag-index",
      "index",
      project,
      (c) =>
        indexProject(project, c, { claude: { model: claude.model, effort: claude.effort }, describe: claudeHeaders }),
      signal,
      { rerun: { name: "rag.index", input: { force: false } } },
    ).done as Promise<IndexReport>;
  };
  try {
    const waiting = (m: string) => ctx.progress({ message: m });
    const r = await indexAfterConversions(project, run, { signal: ctx.signal, waiting });
    return { chunks: r.chunks, ...(r.degraded ? { degraded: r.degraded } : {}) };
  } catch (e) {
    if (ctx.signal.aborted) throw e;
    ctx.log("warn", `The search index was not updated: ${message(e)}`);
    return { error: message(e) };
  }
}

// ponytail: a test whose document changed did not change itself, so its check.json would stay « fresh » —
// the tests that cite the document are re-checked whenever its text appears, changes or goes
export function recheckCiting(ctx: Ctx, project: string, doc: DocJson): CitingTest[] {
  const cited = testsCiting(project, doc);
  if (!cited.length) return cited;
  ctx.progress({
    message: `Re-checking the ${cited.length === 1 ? "test" : `${cited.length} tests`} citing ${doc.code}`,
  });
  recheckMechanical(
    project,
    cited.map((t) => t.id),
  );
  return cited;
}

export type Converted = { doc: DocJson; citedBy: CitingTest[]; index?: Promise<IndexOutcome> };

// ponytail: the figures, the citing tests and the triage belong to the conversion (its slot); the index run is only
// asked for — before the slot is let go, so the run waits for this conversion's batch and is shared (inSlot awaits it)
export async function afterConversion(
  ctx: Ctx,
  project: string,
  doc: DocJson,
  claude: JobRun,
  o: AfterConvert,
): Promise<Converted> {
  await withFigures(ctx, project, doc, claude, o.describeFigures);
  ctx.step?.("cited");
  const citedBy = recheckCiting(ctx, project, doc);
  if (!o.study) await withTriage(ctx, project, doc, claude, o.triage);
  return { doc, citedBy, ...(o.index ? { index: withIndex(ctx, project, claude) } : {}) };
}

export const QUEUE_STEP = { id: "queue", label: "Wait for the other conversions" };

// ponytail: a conversion job runs in one of the project's conversion slots (lib/docs-index.ts); waiting for one is a
// step of its own (« Waiting to convert » on the page), and the index run it asked for is awaited once the slot is free
export async function inSlot(
  ctx: Ctx,
  project: string,
  steps: { id: string; label: string }[],
  work: () => Promise<Converted>,
): Promise<DocJson & Aftermath> {
  const r = await conversionSlot(project, work, {
    signal: ctx.signal,
    onWait: (n) => {
      ctx.steps?.([QUEUE_STEP, ...steps]);
      ctx.step?.("queue");
      ctx.progress({ message: `Waiting to convert (${n} at a time)` });
    },
  });
  const index = r.index ? await r.index : undefined;
  return { ...r.doc, citedBy: r.citedBy, ...(index ? { index } : {}) };
}

// ponytail: the profile Claude studies — of the copies in the document's folder, or of a file not added yet and
// the other copy saved beside it
function inspectFiles(files: { docx?: string; pdf?: string }, signal: AbortSignal) {
  return Promise.all([
    files.docx ? inspectDocx(readFileSync(files.docx)) : undefined,
    files.pdf ? inspectPdf(readFileSync(files.pdf), signal) : undefined,
  ]);
}

export async function inspect(project: string | null, input: { id?: string; file?: string }, signal: AbortSignal) {
  if (!input.id === !input.file)
    throw new UserError("Give either id or file.", "docs.inspect <id> for an added document, or --file <path>.");
  if (input.file) {
    const ext = extname(input.file).toLowerCase();
    if (!existsSync(input.file) || (ext !== ".docx" && ext !== ".pdf"))
      throw new UserError(`Not a .docx or .pdf file: ${input.file}`, "Give the path of the client's .docx or .pdf.");
    const twin = twinOf({ name: input.file, file: "", sha256: "" });
    const files =
      ext === ".docx" ? { docx: input.file, pdf: twin ?? undefined } : { pdf: input.file, docx: twin ?? undefined };
    const [docx, pdf] = await inspectFiles(files, signal);
    const converts = files.docx ? "docx" : "pdf";
    return {
      files,
      converts,
      twin,
      ...(docx && { docx }),
      ...(pdf && { pdf }),
      hints: hintsOf({ docx, pdf, converts }),
    } as const;
  }
  if (!project)
    throw new UserError("No project is open.", "Open or create a project first (testimus project init <dir>).");
  const doc = readDoc(project, input.id!);
  const dir = docDir(project, doc.id);
  const at = (f: string) => (existsSync(join(dir, f)) ? join(dir, f) : undefined);
  const files = { docx: at("source.docx"), pdf: at("source.pdf") };
  const [docx, pdf] = await inspectFiles(files, signal);
  const converts = extname(convertedCopy(project, doc)).toLowerCase() === ".pdf" ? "pdf" : "docx";
  const other = twinOf(doc.source);
  const twin = other && !at(`source${extname(other).toLowerCase()}`) ? other : null;
  return {
    id: doc.id,
    files: Object.fromEntries(
      Object.entries(files)
        .filter(([, v]) => v)
        .map(([k, v]) => [k, relative(project, v!).replace(/\\/g, "/")]),
    ),
    converts,
    twin,
    ...(doc.conversion && { conversion: doc.conversion }),
    ...(docx && { docx }),
    ...(pdf && { pdf }),
    hints: hintsOf({ docx, pdf, twin, converts }),
  } as const;
}

// ponytail: a study or a check answers with the reading options; the figures drawn from the pages stay unless it
// names them
const keepFigures = (next: DocConversion, now?: DocConversion): DocConversion =>
  next.figures || !now?.figures ? next : { ...next, figures: now.figures };

// ponytail: with study, Claude looks at the original before converting (its choice is kept in doc.json, so every
// reconversion gives the same result) and compares the result with the pages after; it may ask for one more
// conversion with other options. A Claude run that fails never fails the conversion.
export function convertWith(
  ctx: Ctx,
  project: string,
  id: string,
  o: { study?: boolean; conversion?: DocConversion },
  claude: JobRun,
): Promise<DocJson> {
  return whileConverting(project, async () => {
    const progress = (message: string) => ctx.progress({ message });
    const hasPdf = () => existsSync(join(docDir(project, id), "source.pdf"));
    if (o.conversion) setConversion(project, id, o.conversion);
    else if (o.study && hasPdf())
      try {
        const doc = readDoc(project, id);
        const r = await studyDoc(ctx, project, doc, await inspect(project, { id }, ctx.signal), claude);
        if (r.conversion) setConversion(project, id, keepFigures(r.conversion, doc.conversion));
        else ctx.log("warn", `Claude's study of ${id} gave no options: ${r.summary.slice(0, 300)}`);
      } catch (e) {
        ctx.log("warn", `Claude did not study ${id}: ${message(e)}`);
      }
    else if (o.study) ctx.log("info", `${id} has no PDF to look at: Claude's study and check are skipped.`);
    let doc = await reconvertDoc(project, id, ctx.signal, progress);
    if (!o.study || !hasPdf()) return doc;
    try {
      const r = await checkConversion(ctx, project, doc, claude);
      const next = r.conversion && keepFigures(r.conversion, doc.conversion);
      if (next && !sameConversion(next, doc.conversion)) {
        setConversion(project, id, next);
        progress("Converting again with the options Claude chose");
        doc = await reconvertDoc(project, id, ctx.signal, progress);
      } else if (r.conversion?.notes && r.conversion.notes !== doc.conversion?.notes)
        doc = setConversion(project, id, { ...doc.conversion, notes: r.conversion.notes });
    } catch (e) {
      ctx.log("warn", `Claude did not check ${id}: ${message(e)}`);
    }
    return doc;
  });
}

export type Picked = { path?: string; name?: string; dataBase64?: string };
export type AddInput = {
  file?: string;
  name?: string;
  dataBase64?: string;
  pdf?: string;
  pdfName?: string;
  pdfBase64?: string;
  id?: string;
  kind?: DocKind;
};

// ponytail: an uploaded original (the page's drop zone) is saved under .testimus/uploads only for the copy: the
// folder goes however the add ends
export function withUploads<T>(project: string, work: (save: (name: string, b64: string) => string) => Promise<T>) {
  return scope(async (s) => {
    const up = join(project, ".testimus", "uploads", randomBytes(4).toString("hex"));
    s.defer(() => rmSync(up, { recursive: true, force: true }));
    return work((name, b64) => {
      mkdirSync(up, { recursive: true });
      const path = join(up, basename(name));
      writeAtomic(path, Buffer.from(b64, "base64"));
      return path;
    });
  });
}

// ponytail: the copy of one document (its .docx or .pdf, and the .pdf rendering of a .docx); an upload keeps its own
// name as source and says it was sent from the page
export async function copyIn(
  ctx: Ctx,
  project: string,
  save: (name: string, b64: string) => string,
  input: AddInput,
  convert: boolean,
): Promise<DocJson> {
  const file = input.dataBase64 ? save(input.name || "document.docx", input.dataBase64) : input.file;
  if (!file) throw new UserError("No document given.", "Give --file <path>, or name + dataBase64.");
  const pdf = input.pdfBase64 ? save(input.pdfName || "rendering.pdf", input.pdfBase64) : input.pdf;
  const progress = (message: string) => ctx.progress({ message });
  const added = await (convert
    ? whileConverting(project, () =>
        addDoc(project, { file, pdf, id: input.id, kind: input.kind }, ctx.signal, progress),
      )
    : addDoc(project, { file, pdf, id: input.id, kind: input.kind, convert: false }, ctx.signal, progress));
  if (!input.dataBase64) return added;
  const doc = { ...added, source: { ...added.source, name: basename(input.name || "document.docx"), uploaded: true } };
  writeDoc(project, doc);
  return doc;
}

export const nameOf = (p: Picked) => p.name || (p.path ? basename(p.path) : "");
const stem = (n: string) => n.replace(/\.[^.]+$/, "").toLowerCase();

// ponytail: of the files a person dropped or picked, each .docx is one document with the .pdf of the same name as
// its rendering; a .pdf or a text file alone is one document; anything else is refused
export function pairFiles(files: Picked[]): { docs: { main: Picked; pdf?: Picked }[]; rejected: Picked[] } {
  const ok = (p: Picked) => /\.(docx|pdf|txt|md)$/i.test(nameOf(p)) && (p.path || p.dataBase64 !== undefined);
  const words = files.filter((f) => ok(f) && /\.docx$/i.test(nameOf(f)));
  const pdfs = files.filter((f) => ok(f) && /\.pdf$/i.test(nameOf(f)));
  const paired = new Set<Picked>();
  const docs = words.map((main) => {
    const pdf = pdfs.find((p) => !paired.has(p) && stem(nameOf(p)) === stem(nameOf(main)));
    if (pdf) paired.add(pdf);
    return pdf ? { main, pdf } : { main };
  });
  for (const p of pdfs) if (!paired.has(p)) docs.push({ main: p });
  for (const t of files.filter((f) => ok(f) && /\.(txt|md)$/i.test(nameOf(f)))) docs.push({ main: t });
  return { docs, rejected: files.filter((f) => !ok(f)) };
}

export function addInputOf(d: { main: Picked; pdf?: Picked }): AddInput {
  const one = (p: Picked, file: "file" | "pdf", name: "name" | "pdfName", data: "dataBase64" | "pdfBase64") =>
    p.path ? { [file]: p.path } : { [name]: nameOf(p), [data]: p.dataBase64 };
  return { ...one(d.main, "file", "name", "dataBase64"), ...(d.pdf ? one(d.pdf, "pdf", "pdfName", "pdfBase64") : {}) };
}
