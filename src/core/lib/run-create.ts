import { existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runImage } from "../../shared/run-image.ts";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import type { Review } from "../types.ts";
import { copyFileAtomic } from "./atomic.ts";
import { fieldOrder } from "./columns.ts";
import { writeJson } from "./project.ts";
import { osUser } from "./review.ts";
import { type RunFile, type RunTest, runDir, runsDir } from "./runs.ts";
import { inFolder, listLocalTests, readTest, testDir } from "./store.ts";
import { insideTest, mapRefs } from "./test-blocks.ts";

// ponytail: making a run — which tests, frozen as they are now with copies of their pictures, in a folder of its own
// named after the run

export function slugOf(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/, "") || "run"
  );
}

export function freeSlug(project: string, name: string): string {
  const base = slugOf(name);
  let slug = base;
  for (let n = 2; existsSync(join(runsDir(project), slug)); n++) slug = `${base}-${n}`;
  return slug;
}

export type Pick = { tests?: string[]; folder?: string; labels?: string[]; review?: Review[] };

// ponytail: the tests of a new run — the ids named, in their order, then every test of the folder, holding one of the
// labels, or in one of the review states, in the order of the tests list; each once
export function pickTests(project: string, p: Pick): string[] {
  const refs = listLocalTests(project);
  const named = (p.tests ?? []).map((n) => n.trim()).filter(Boolean);
  const missing = named.filter((n) => !refs.some((r) => r.id === n || r.key === n));
  if (missing.length)
    throw new UserError(`No test ${missing.join(", ")} in this project.`, "testimus tests list shows the tests.");
  const out = new Set(named.map((n) => refs.find((r) => r.id === n || r.key === n)?.id as string));
  const labels = (p.labels ?? []).map((l) => l.trim()).filter(Boolean);
  if (p.folder === undefined && !labels.length && !p.review?.length) return [...out];
  for (const ref of refs) {
    if (out.has(ref.id)) continue;
    if (p.folder !== undefined && !inFolder(ref.folder, p.folder)) continue;
    if (p.review?.length && !p.review.includes(ref.review)) continue;
    if (labels.length && !readTest(project, ref.id).test.labels.some((l) => labels.includes(l))) continue;
    out.add(ref.id);
  }
  return [...out];
}

// ponytail: a picture a step shows (embedded in a field or attached) is a file of the test folder; the run keeps its
// own copy under images/<testId>/, so a test edited or deleted later leaves the run whole
function imagesOf(fields: Record<string, string>, attached: string[]): string[] {
  const out = new Set<string>();
  for (const text of Object.values(fields))
    mapRefs(text, (file, _p, ref) => {
      if (insideTest(file) && !/^https?:/i.test(file)) out.add(file);
      return ref;
    });
  for (const f of attached) if (insideTest(f)) out.add(f);
  return [...out];
}

export function freezeTest(project: string, id: string, order: readonly string[]): RunTest {
  const { test } = readTest(project, id);
  const rank = (k: string) => (order.indexOf(k) < 0 ? order.length : order.indexOf(k));
  return {
    id,
    ...(test.key ? { key: test.key } : {}),
    ...(test.folder ? { folder: test.folder } : {}),
    summary: test.summary,
    ...(test.description.trim() ? { description: test.description.trim() } : {}),
    preconditions: [...test.preconditions],
    steps: test.steps.map((s) => {
      const fields = Object.fromEntries(
        Object.entries(s.fields)
          .filter(([, v]) => v.trim() !== "")
          .sort(([a], [b]) => rank(a) - rank(b)),
      );
      return {
        fields,
        images: imagesOf(
          fields,
          s.images.map((i) => i.file),
        ),
        ...(s.sources.length ? { sources: s.sources.map((src) => ({ ...src })) } : {}),
      };
    }),
  };
}

export type NewRun = { name: string; ids: string[] };

export async function createRun(project: string, n: NewRun): Promise<string> {
  const name = n.name.trim();
  if (!name) throw new UserError("A run needs a name.", 'Name it, e.g. --name "Recette J5 — Sectionneurs".');
  if (!n.ids.length)
    throw new UserError(
      "No test for this run.",
      "Name tests, or pick a folder, labels or a review state that has some.",
    );
  const order = fieldOrder(project);
  const tests = n.ids.map((id) => freezeTest(project, id, order));
  const slug = freeSlug(project, name);
  const final = runDir(project, slug);
  const tmp = `${final}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  try {
    for (const t of tests)
      for (const file of new Set(t.steps.flatMap((s) => s.images))) {
        const from = join(testDir(project, t.id), file);
        if (existsSync(from)) await copyFileAtomic(from, join(tmp, runImage(t.id, file)));
      }
    const run: RunFile = {
      name,
      createdAt: env.now().toISOString(),
      createdBy: osUser(),
      tests,
    };
    writeJson(join(tmp, "run.json"), run);
    renameSync(tmp, final);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  return slug;
}
