import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { writeAtomic } from "./atomic.ts";
import { readJson } from "./project.ts";
import { FORMAT, filesUnder, outsidePath, PICTURE, plainFile } from "./run-pages.ts";
import {
  normalResult,
  normalRun,
  type RunFile,
  type RunResult,
  readResult,
  readRunFile,
  runDir,
  writeResult,
} from "./runs.ts";

// ponytail: the results of a run played as pages, read back into the project — the plan first, then the writing. The
// newer result of a test wins, the older is kept in its history (and a version already there is settled, never asked
// again); comments merge by id, screenshots by name; a run the project does not have is made from the pages. What the
// pages hold came from another PC: it is read as untrusted (normalResult, plain files only)

type Shot = { file: string; step?: number; data?: string };
type Source = {
  path: string;
  dir: string;
  slug?: string;
  run: RunFile;
  results: Record<string, { result: Record<string, unknown>; shots: Shot[] }>;
};

const objectOr = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const stampOf = (r: Record<string, unknown> | null) => (typeof r?.updatedAt === "string" ? r.updatedAt : "");
const shotsOf = (v: unknown): Shot[] =>
  (Array.isArray(v) ? v : []).flatMap((x) => {
    const a = objectOr(x);
    if (!a || typeof a.file !== "string" || !PICTURE.test(a.file)) return [];
    return [
      {
        file: a.file,
        ...(typeof a.step === "number" ? { step: a.step } : {}),
        ...(typeof a.data === "string" ? { data: a.data } : {}),
      },
    ];
  });

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
  if (!Array.isArray(raw?.tests)) throw new UserError(`${file} is not a run: it lists no test.`);
  if (raw.format !== FORMAT)
    throw new UserError(
      typeof raw.format === "string" && raw.format.startsWith("testimus-run-pages/")
        ? `${file} was exported by another version of Testimus (${raw.format}); this one reads ${FORMAT}.`
        : `${file} is not a run exported as pages (no format ${FORMAT}).`,
      "Pick the run.json of a run exported by this Testimus (Export as pages…), or the one its page saved.",
    );
  const run = normalRun(raw as Partial<RunFile>, typeof raw.slug === "string" ? raw.slug : "Imported run");
  const results: Source["results"] = {};
  const inline = objectOr(raw.results) ?? {};
  for (const t of run.tests) {
    const rel = `results/${t.id}.json`;
    const onDisk = plainFile(dir, rel) ? objectOr(readJson<unknown>(join(dir, rel), null)) : null;
    const a = objectOr(inline[t.id]);
    const newer = !a ? onDisk : !onDisk ? a : stampOf(onDisk) >= stampOf(a) ? onDisk : a;
    if (newer) results[t.id] = { result: newer, shots: [...shotsOf(a?.attachments), ...shotsOf(onDisk?.attachments)] };
  }
  return { path: file, dir, ...(typeof raw.slug === "string" ? { slug: raw.slug } : {}), run, results };
}

const core = (r: RunResult) => JSON.stringify([r.status, r.steps, r.blockedReason ?? ""]);
const versionKey = (h: { status: string; steps: unknown; updatedAt?: string }) =>
  JSON.stringify([h.status, h.steps, h.updatedAt]);
const version = (r: RunResult, replacedAt: string) => ({
  status: r.status,
  steps: r.steps,
  ...(r.blockedReason ? { blockedReason: r.blockedReason } : {}),
  ...(r.updatedAt ? { updatedAt: r.updatedAt } : {}),
  ...(r.updatedBy ? { updatedBy: r.updatedBy } : {}),
  replacedAt,
});
const dataOf = (data: string) => new Uint8Array(Buffer.from(data.replace(/^data:[^,]*,/, ""), "base64"));
const madeOn = (r: RunFile) =>
  r.createdAt ? `${r.createdAt.slice(0, 16).replace("T", " ")}${r.createdBy ? ` by ${r.createdBy}` : ""}` : "unknown";

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
  if (!creates && src.run.createdAt !== run.createdAt)
    throw new UserError(
      `These pages come from another run than « ${run.name} » of this project, though it has their name: theirs was made ${madeOn(src.run)}, this one ${madeOn(run)}.`,
      "Import them as a run of their own: give it a new name (runs import --run <new-run>).",
    );
  const now = env.now().toISOString();
  const plan = {
    results: 0,
    comments: 0,
    questions: 0,
    answers: 0,
    attachments: 0,
    conflicts: [] as Conflict[],
    stepsChanged: [] as { test: string; summary: string; here: number; pages: number }[],
  };
  const writes: { test: string; result: RunResult; pictures: { file: string; bytes: Uint8Array }[] }[] = [];
  for (const t of run.tests) {
    const sent = src.results[t.id];
    if (!sent) continue;
    const frozen = src.run.tests.find((x) => x.id === t.id)?.steps.length ?? t.steps.length;
    const moved = frozen !== t.steps.length;
    const here = creates ? normalResult(null, t.steps.length) : readResult(project, slug, t);
    const pages = normalResult(sent.result, frozen);
    if (moved) {
      plan.stepsChanged.push({ test: t.id, summary: t.summary, here: t.steps.length, pages: frozen });
      pages.steps = here.steps;
      delete pages.history;
      pages.comments = pages.comments.map(({ step: _, ...c }) => c);
    }
    const next: RunResult = { ...here, comments: [...here.comments], attachments: [...here.attachments] };
    let changed = false;
    const settled = (here.history ?? []).some((h) => versionKey(h) === versionKey(pages));
    if (pages.updatedAt && !settled && core(pages) !== core(here)) {
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
              versionKey(h),
              h,
            ]),
          ).values(),
        ],
      });
      if (win.blockedReason) next.blockedReason = win.blockedReason;
      else delete next.blockedReason;
      if (pagesWin) plan.results++;
      changed = true;
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
    for (const a of sent.shots) {
      if (next.attachments.some((x) => x.file === a.file)) continue;
      const bytes = a.data ? dataOf(a.data) : picture(src.dir, t.id, a.file);
      if (!bytes?.length) continue;
      pictures.push({ file: a.file, bytes });
      const step = !moved && Number.isInteger(a.step) && (a.step ?? 0) >= 1 && (a.step ?? 0) <= t.steps.length;
      next.attachments.push({ file: a.file, ...(step ? { step: a.step } : {}) });
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

const picture = (dir: string, testId: string, name: string) =>
  plainFile(dir, `results/${testId}/${name}`) ? new Uint8Array(readFileSync(join(dir, "results", testId, name))) : null;

function createFromPages(project: string, slug: string, src: Source): void {
  const dir = runDir(project, slug);
  if (existsSync(dir)) throw new UserError(`test-runs/${slug} already exists.`);
  const { name, version, environment, createdAt, createdBy, tests } = src.run;
  writeAtomic(
    join(dir, "run.json"),
    `${JSON.stringify({ name, version, environment, createdAt, createdBy, tests }, null, 2)}\n`,
  );
  for (const rel of filesUnder(join(src.dir, "images")))
    if (/^[^/]+\/[^/]+$/.test(rel) && PICTURE.test(basename(rel)) && plainFile(src.dir, `images/${rel}`))
      writeAtomic(join(dir, "images", rel), readFileSync(join(src.dir, "images", rel)));
}
