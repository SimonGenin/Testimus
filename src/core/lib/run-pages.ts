import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { writeAtomic } from "./atomic.ts";
import { readJson } from "./project.ts";
import { osUser } from "./review.ts";
import {
  normalResult,
  normalRun,
  type RunFile,
  type RunResult,
  readResult,
  readRunFile,
  resultFile,
  runDir,
  writeResult,
} from "./runs.ts";

// ponytail: a run exported as pages — a folder anyone opens in a browser, on any PC (index.html, the run and its
// results, the tests' pictures, a small Node server and its starters), then read back into the project: the newer
// result of a test wins, the older one is kept in its history

const FORMAT = "testimus-run-pages/1";
const TEMPLATE_FILES = ["index.html", "serve.mjs", "start.cmd", "start.sh", "README.md"];
const PLACEHOLDER = '{"run":null,"results":{}}';
const PICTURE = /^[A-Za-z0-9][\w.-]*\.(png|jpe?g|gif|webp|bmp)$/i;

export function pagesTemplateDir(): string {
  const dev = join(import.meta.dirname ?? ".", "..", "..", "..", "templates", "run-pages");
  if (existsSync(dev)) return dev;
  return join(dirname(process.argv[1] ?? "."), "templates", "run-pages");
}

function outsidePath(path: string, what: string): string {
  if (!isAbsolute(path))
    throw new UserError(`${what} must be an absolute path: ${path}.`, "Give the folder's full path.");
  if (/^(\\\\|\/\/)/.test(path))
    throw new UserError(`${what} is a network path: ${path}.`, "Copy the folder to this PC first, then give its path.");
  return path;
}

function filesUnder(dir: string, rel = ""): string[] {
  if (!existsSync(join(dir, rel))) return [];
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? filesUnder(dir, r) : e.isFile() && !e.name.endsWith(".tmp") ? [r] : [];
  });
}

const embed = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

export type ExportInput = { run: string; dir: string; results?: boolean };

export function exportRun(project: string, input: ExportInput) {
  const dir = outsidePath(input.dir, "The export folder");
  if (existsSync(dir) && (!statSync(dir).isDirectory() || readdirSync(dir).length))
    throw new UserError(`${dir} is not empty.`, "Pick a new or empty folder: an export never writes over another.");
  const from = runDir(project, input.run);
  const run = readRunFile(project, input.run);
  const withResults = input.results !== false;
  const results: Record<string, RunResult> = {};
  if (withResults)
    for (const t of run.tests)
      if (existsSync(resultFile(from, t.id))) results[t.id] = readResult(project, input.run, t);
  const { importedAt: _, ...frozen } = run;
  const pages = {
    format: FORMAT,
    slug: input.run,
    exportedAt: env.now().toISOString(),
    exportedBy: osUser(),
    ...frozen,
  };
  const tpl = pagesTemplateDir();
  let files = 0;
  const put = (rel: string, data: string | Uint8Array) => {
    writeAtomic(join(dir, rel), data);
    files++;
  };
  for (const f of TEMPLATE_FILES) {
    const text = readFileSync(join(tpl, f), "utf8");
    if (f === "index.html") {
      if (!text.includes(PLACEHOLDER)) throw new Error("templates/run-pages/index.html has no data placeholder.");
      put(
        f,
        text.replace(PLACEHOLDER, () => embed({ run: pages, results })),
      );
    } else put(f, f.endsWith(".cmd") ? text.replace(/\r?\n/g, "\r\n") : text);
  }
  put("run.json", `${JSON.stringify(pages, null, 2)}\n`);
  for (const rel of filesUnder(from, "images")) put(rel, readFileSync(join(from, rel)));
  if (withResults)
    for (const rel of filesUnder(from, "results"))
      if (/^results\/[^/]+\.json$/.test(rel) ? results[basename(rel, ".json")] : true)
        put(rel, readFileSync(join(from, rel)));
  return { run: input.run, dir, files, tests: run.tests.length, results: Object.keys(results).length };
}

type Source = {
  path: string;
  slug?: string;
  run: RunFile;
  results: Record<string, Partial<RunResult> & { attachments?: { file: string; step?: number; data?: string }[] }>;
  pictures: (testId: string, file: string) => Uint8Array | null;
  images: string | null;
};

// ponytail: what the pages hold — run.json (its results inline when the browser saved it), else results/<id>.json;
// both there: the newer wins
function readSource(input: { dir?: string; file?: string }): Source {
  if (!input.dir === !input.file)
    throw new UserError("Give either the folder of the pages or a run.json.", "runs import --dir <folder>.");
  const file = input.file
    ? outsidePath(input.file, "The run file")
    : join(outsidePath(input.dir as string, "The folder"), "run.json");
  const dir = dirname(file);
  if (!existsSync(file)) throw new UserError(`No run.json in ${dir}.`, "Pick the folder the run was exported to.");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    throw new UserError(`${file} is not a run: it is not JSON.`, "Pick the run.json of an exported run.");
  }
  if (!Array.isArray(raw.tests)) throw new UserError(`${file} is not a run: it lists no test.`);
  const run = normalRun(raw as Partial<RunFile>, typeof raw.slug === "string" ? raw.slug : "Imported run");
  const results: Source["results"] = {};
  const inline = raw.results && typeof raw.results === "object" ? (raw.results as Source["results"]) : {};
  for (const t of run.tests) {
    const onDisk = readJson<Source["results"][string] | null>(join(dir, "results", `${t.id}.json`), null);
    const a = inline[t.id];
    const newer = !a ? onDisk : !onDisk ? a : (onDisk.updatedAt ?? "") >= (a.updatedAt ?? "") ? onDisk : a;
    if (newer) results[t.id] = { ...newer, attachments: [...(a?.attachments ?? []), ...(onDisk?.attachments ?? [])] };
  }
  return {
    path: file,
    ...(typeof raw.slug === "string" ? { slug: raw.slug } : {}),
    run,
    results,
    pictures: (testId, name) => {
      if (!PICTURE.test(name)) return null;
      const p = join(dir, "results", testId, name);
      return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
    },
    images: existsSync(join(dir, "images")) ? join(dir, "images") : null,
  };
}

const core = (r: RunResult) => JSON.stringify([r.status, r.steps, r.blockedReason ?? ""]);
const version = (r: RunResult, replacedAt: string) => ({
  status: r.status,
  steps: r.steps,
  ...(r.blockedReason ? { blockedReason: r.blockedReason } : {}),
  ...(r.updatedAt ? { updatedAt: r.updatedAt } : {}),
  ...(r.updatedBy ? { updatedBy: r.updatedBy } : {}),
  replacedAt,
});
const dataOf = (data: string) => new Uint8Array(Buffer.from(data.replace(/^data:[^,]*,/, ""), "base64"));

export type Conflict = {
  test: string;
  summary: string;
  kept: "pages" | "here";
  here: { status: string; updatedAt?: string; updatedBy?: string };
  pages: { status: string; updatedAt?: string; updatedBy?: string };
};

export type ImportInput = { dir?: string; file?: string; run?: string; dryRun?: boolean };

export function importRun(project: string, input: ImportInput) {
  const src = readSource(input);
  const slug = input.run ?? src.slug;
  if (!slug)
    throw new UserError("This run.json does not say which run it is.", "Name the run: runs import --run <run>.");
  const creates = !existsSync(join(runDir(project, slug), "run.json"));
  const run = creates ? src.run : readRunFile(project, slug);
  const now = env.now().toISOString();
  const plan = { results: 0, comments: 0, questions: 0, answers: 0, attachments: 0, conflicts: [] as Conflict[] };
  const writes: { test: string; result: RunResult; pictures: { file: string; bytes: Uint8Array }[] }[] = [];
  for (const t of run.tests) {
    const raw = src.results[t.id];
    if (!raw) continue;
    const pages = normalResult(raw, t.steps.length);
    const here = creates ? normalResult(null, t.steps.length) : readResult(project, slug, t);
    const next: RunResult = { ...here, comments: [...here.comments], attachments: [...here.attachments] };
    let changed = false;
    if (pages.updatedAt && core(pages) !== core(here)) {
      const touched = !!here.updatedAt;
      const pagesWin = !touched || pages.updatedAt >= (here.updatedAt ?? "");
      if (touched)
        plan.conflicts.push({
          test: t.id,
          summary: t.summary,
          kept: pagesWin ? "pages" : "here",
          here: { status: here.status, updatedAt: here.updatedAt, updatedBy: here.updatedBy },
          pages: { status: pages.status, updatedAt: pages.updatedAt, updatedBy: pages.updatedBy },
        });
      const [win, lose] = pagesWin ? [pages, here] : [here, pages];
      Object.assign(next, {
        status: win.status,
        steps: win.steps,
        updatedAt: win.updatedAt,
        updatedBy: win.updatedBy,
        history: [
          ...new Map(
            [...(here.history ?? []), ...(pages.history ?? []), ...(touched ? [version(lose, now)] : [])].map((h) => [
              JSON.stringify([h.status, h.steps, h.updatedAt]),
              h,
            ]),
          ).values(),
        ],
      });
      if (win.blockedReason) next.blockedReason = win.blockedReason;
      else delete next.blockedReason;
      if (pagesWin) {
        plan.results++;
        changed = true;
      }
      if (touched) changed = true;
    }
    for (const c of pages.comments) {
      const mine = next.comments.find((x) => x.id === c.id);
      if (!mine) {
        next.comments.push(c);
        if (c.kind === "question") plan.questions++;
        else plan.comments++;
        changed = true;
      } else if (c.answer && !mine.answer) {
        Object.assign(mine, { answer: c.answer, answeredBy: c.answeredBy, answeredAt: c.answeredAt });
        plan.answers++;
        changed = true;
      }
    }
    next.comments.sort((a, b) => a.at.localeCompare(b.at));
    const pictures: { file: string; bytes: Uint8Array }[] = [];
    for (const a of raw.attachments ?? []) {
      if (!a || !PICTURE.test(a.file ?? "") || next.attachments.some((x) => x.file === a.file)) continue;
      const bytes = a.data ? dataOf(a.data) : src.pictures(t.id, a.file);
      if (!bytes?.length) continue;
      pictures.push({ file: a.file, bytes });
      next.attachments.push({ file: a.file, ...(typeof a.step === "number" ? { step: a.step } : {}) });
      plan.attachments++;
      changed = true;
    }
    if (changed) writes.push({ test: t.id, result: next, pictures });
  }
  const out = {
    run: slug,
    name: run.name,
    source: src.path,
    creates,
    dryRun: !!input.dryRun,
    tests: run.tests.length,
    ...plan,
  };
  if (input.dryRun) return out;
  if (creates) createFromPages(project, slug, src);
  const dir = runDir(project, slug);
  for (const w of writes) {
    for (const p of w.pictures) writeAtomic(join(dir, "results", w.test, p.file), p.bytes);
    writeResult(project, slug, w.test, w.result);
  }
  const file = join(dir, "run.json");
  writeAtomic(file, `${JSON.stringify({ ...readRunFile(project, slug), importedAt: now }, null, 2)}\n`);
  return out;
}

function createFromPages(project: string, slug: string, src: Source): void {
  const dir = runDir(project, slug);
  if (existsSync(dir)) throw new UserError(`test-runs/${slug} already exists.`);
  const { name, version, environment, createdAt, createdBy, tests } = src.run;
  writeAtomic(
    join(dir, "run.json"),
    `${JSON.stringify({ name, version, environment, createdAt, createdBy, tests }, null, 2)}\n`,
  );
  if (src.images)
    for (const rel of filesUnder(src.images))
      if (/^[^/]+\/[^/]+$/.test(rel) && PICTURE.test(basename(rel)))
        writeAtomic(join(dir, "images", rel), readFileSync(join(src.images, rel)));
}
